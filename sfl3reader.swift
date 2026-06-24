#!/usr/bin/env swift
//
// sfl3reader.swift
//
// Decodes a macOS .sfl3 "shared file list" archive (used for per-app
// "Recent Documents" lists) and outputs the resolved file paths as JSON.
//
// .sfl3 files are NSKeyedArchiver binary plists. Their internal structure:
//   root (NSDictionary)
//     "items" (NSArray)
//       [n] (NSDictionary): "visibility", "CustomItemProperties", "Bookmark", "uuid"
//     "properties" (NSDictionary)
//
// Usage:
//   swift sfl3reader.swift <path-to-.sfl3>

// Foundation: Swift's standard library for data, strings, URLs, JSON, etc.
// CoreServices: macOS framework that includes Spotlight metadata (MDItem API).
import Foundation
import CoreServices

// `guard` is Swift's early-exit pattern. If the condition is false, the `else`
// block runs and must exit the current scope (here: the whole script via exit()).
// `CommandLine.arguments` is an array where [0] = the script name, [1] = first arg.
guard CommandLine.arguments.count > 1 else {
    // FileHandle.standardError writes to stderr instead of stdout.
    // `.data(using: .utf8)!` converts a String to raw bytes. The `!` force-unwraps
    // the Optional — safe here because UTF-8 encoding of a string literal never fails.
    FileHandle.standardError.write("Usage: sfl3reader <path-to-.sfl3>\n".data(using: .utf8)!)
    exit(1)
}

// `NSString` is the Objective-C string class. `expandingTildeInPath` expands "~"
// to the user's home directory — a method that doesn't exist on Swift's String type.
let sfl3FilePath = (CommandLine.arguments[1] as NSString).expandingTildeInPath

// `URL(fileURLWithPath:)` creates a file-system URL from a POSIX path string.
let sfl3FileURL = URL(fileURLWithPath: sfl3FilePath)

// `try?` runs a throwing expression and returns nil on failure (instead of crashing).
// `Data(contentsOf:)` reads the entire file into memory as raw bytes.
guard let rawFileData = try? Data(contentsOf: sfl3FileURL) else {
    FileHandle.standardError.write("Could not read file: \(sfl3FilePath)\n".data(using: .utf8)!)
    exit(1)
}

// NSKeyedArchiver plists use the "$objects" / "$top" structure internally.
// `PropertyListSerialization` deserializes the binary plist into Swift dictionaries/arrays
// without needing to know the archived class types upfront.
// `as? [String: Any]` is a conditional downcast — returns nil if the type doesn't match.
guard
    let archivedPlist = try? PropertyListSerialization.propertyList(from: rawFileData, options: [], format: nil) as? [String: Any],
    let archivedObjects = archivedPlist["$objects"] as? [Any],  // flat table of all serialized objects
    let topLevelRefs = archivedPlist["$top"] as? [String: Any]  // named pointers into $objects
else {
    FileHandle.standardError.write("Could not parse plist or find $objects/$top\n".data(using: .utf8)!)
    exit(1)
}

// NSKeyedArchiver uses CF$UID values as typed integer references into $objects.
// This function extracts that integer index from whatever form the runtime hands back.
//
// Two forms exist depending on macOS version:
//   Older: PropertyListSerialization returns them as plain dicts ["CF$UID": N]
//   Newer: Returns opaque CFKeyedArchiverUID objects whose .description looks like
//          "<CFKeyedArchiverUID 0x...>{value = N}"
func extractObjectIndex(from uidReference: Any?) -> Int? {
    guard let uidReference = uidReference else { return nil }

    // Try the older dict form first.
    if let dict = uidReference as? [String: Any], dict.count == 1, let index = dict["CF$UID"] as? Int {
        return index
    }

    // Fall back to parsing the opaque object's string description.
    // `hasPrefix` checks if a string starts with a given substring.
    let uidDescription = String(describing: uidReference)
    guard uidDescription.hasPrefix("<CFKeyedArchiverUID "),
          let valueStart = uidDescription.range(of: "{value = ")?.upperBound,
          let valueEnd = uidDescription[valueStart...].firstIndex(of: "}") else { return nil }
    return Int(String(uidDescription[valueStart..<valueEnd]))
}

// Looks up an object in the $objects table by its UID reference.
// Returns the reference itself (unwrapped) if it's not a UID.
func resolveObjectReference(_ uidReference: Any?) -> Any? {
    guard let uidReference = uidReference,
          let index = extractObjectIndex(from: uidReference),
          index >= 0, index < archivedObjects.count else { return uidReference }
    return archivedObjects[index]
}

// Reads the "$classname" of a serialized object dict — used to decide how to decode it.
func className(of serializedObject: [String: Any]) -> String? {
    guard let classRef = resolveObjectReference(serializedObject["$class"]) as? [String: Any] else { return nil }
    return classRef["$classname"] as? String
}

// Tracks which object indices are currently being decoded to prevent infinite loops
// from circular references in the archive. `Set<Int>` is an unordered collection of
// unique integers with O(1) insert/lookup.
var inProgressObjectIndices = Set<Int>()

// Recursively walks the $objects graph, converting NSKeyedArchiver internals into
// plain Swift types: NSDictionary → [String: Any], NSArray → [Any], primitives as-is.
//
// `depth` guards against deeply nested structures causing a stack overflow.
func decodeArchivedObject(_ uidReference: Any?, depth: Int = 0) -> Any? {
    guard let uidReference = uidReference, depth < 50 else { return nil }

    // If this is a UID reference, resolve it and decode the pointed-to object.
    if let objectIndex = extractObjectIndex(from: uidReference) {
        // Skip if already decoding this index (cycle guard).
        if inProgressObjectIndices.contains(objectIndex) { return nil }
        inProgressObjectIndices.insert(objectIndex)
        let decodedValue = decodeArchivedObject(resolveObjectReference(uidReference), depth: depth + 1)
        inProgressObjectIndices.remove(objectIndex)
        return decodedValue
    }

    // If it's a dictionary, check its $classname to decide how to unpack it.
    if let serializedDict = uidReference as? [String: Any] {
        if let archivedClassName = className(of: serializedDict) {
            switch archivedClassName {

            // NSDictionary is stored as parallel arrays of keys and values.
            case "NSDictionary", "NSMutableDictionary":
                let keyRefs = (serializedDict["NS.keys"] as? [Any]) ?? []
                let valueRefs = (serializedDict["NS.objects"] as? [Any]) ?? []
                var decodedDict: [String: Any] = [:]
                // `zip` pairs elements from two sequences by index.
                for (keyRef, valueRef) in zip(keyRefs, valueRefs) {
                    if let decodedKey = decodeArchivedObject(keyRef, depth: depth + 1) as? String {
                        decodedDict[decodedKey] = decodeArchivedObject(valueRef, depth: depth + 1)
                    }
                }
                return decodedDict

            // NSArray/NSSet are stored as a single array of object refs.
            case "NSArray", "NSMutableArray", "NSSet", "NSMutableSet":
                let objectRefs = (serializedDict["NS.objects"] as? [Any]) ?? []
                // Trailing closure syntax: `.map { }` transforms each element.
                return objectRefs.map { decodeArchivedObject($0, depth: depth + 1) }

            // Unknown class: decode all fields and preserve $classname for inspection.
            default:
                var decodedDict: [String: Any] = [:]
                // `where` adds a filter condition to a `for` loop.
                for (key, value) in serializedDict where key != "$class" {
                    decodedDict[key] = decodeArchivedObject(value, depth: depth + 1)
                }
                decodedDict["$classname"] = archivedClassName
                return decodedDict
            }
        }

        // Plain dict with no $classname — decode values recursively.
        var decodedDict: [String: Any] = [:]
        for (key, value) in serializedDict {
            decodedDict[key] = decodeArchivedObject(value, depth: depth + 1)
        }
        return decodedDict
    }

    // NSArray at the raw plist level (not via NS.objects) — decode each element.
    if let rawArray = uidReference as? [Any] {
        return rawArray.map { decodeArchivedObject($0, depth: depth + 1) }
    }

    // Primitive value (String, Int, Data, etc.) — return as-is.
    return uidReference
}

// Decode the root object from the archive. "root" in $top points to the top-level dict.
guard let rootDict = decodeArchivedObject(topLevelRefs["root"]) as? [String: Any] else {
    FileHandle.standardError.write("Could not decode root object\n".data(using: .utf8)!)
    exit(1)
}

guard let rawItems = rootDict["items"] as? [Any] else {
    FileHandle.standardError.write("No 'items' array in decoded root\n".data(using: .utf8)!)
    exit(1)
}

// `struct` is a value type (copied on assignment, unlike classes which are references).
// `Codable` is a Swift protocol that auto-generates JSON encode/decode logic for the struct.
// `?` after a type means Optional — the value can be nil.
struct RecentItem: Codable {
    let name: String?         // filename component of the path
    let path: String?         // full POSIX path, nil if bookmark couldn't be resolved
    let order: Int            // position in the .sfl3 list (0 = most recently opened)
    let lastUsedDate: String? // ISO 8601 timestamp from Spotlight, nil if not indexed
}

var resolvedItems: [RecentItem] = []

// `enumerated()` yields (index, element) pairs while iterating.
for (listPosition, rawItem) in rawItems.enumerated() {

    // `as?` is a safe downcast — skips this item if it's not a dictionary.
    guard let itemDict = rawItem as? [String: Any] else { continue }

    var resolvedPath: String? = nil

    // Each item stores a CFURLBookmarkData blob under "Bookmark".
    // `URL(resolvingBookmarkData:)` converts it back to a file URL, even if the file
    // moved (macOS tracks renames/moves in the bookmark). `isStale = true` means
    // the file moved and the bookmark should ideally be refreshed, but the URL is
    // still valid — we just use it as-is.
    if let bookmarkData = itemDict["Bookmark"] as? Data {
        var bookmarkIsStale = false
        if let resolvedFileURL = try? URL(
            resolvingBookmarkData: bookmarkData,
            options: [.withoutUI, .withoutMounting], // don't show dialogs or mount volumes
            relativeTo: nil,
            bookmarkDataIsStale: &bookmarkIsStale     // `&` passes by reference (inout parameter)
        ) {
            resolvedPath = resolvedFileURL.path
        }
    }

    // Skip items where the bookmark couldn't be resolved (file deleted or inaccessible).
    // This matches macOS's own "Open Recent" behavior — broken entries are silently omitted.
    guard let resolvedPath = resolvedPath else { continue }

    // `lastPathComponent` extracts the filename from a full path ("/foo/bar.txt" → "bar.txt").
    let fileName = (resolvedPath as NSString).lastPathComponent

    // Query Spotlight for the last time this file was opened.
    // `MDItemCreate` creates a metadata handle for the file at the given path.
    // `MDItemCopyAttribute` reads a named metadata attribute — returns Any? (AnyObject? bridged).
    // `kMDItemLastUsedDate` is a CoreServices constant for Spotlight's last-used timestamp.
    // `as CFString` bridges Swift's String to Core Foundation's CFString type.
    var lastUsedDate: String? = nil
    if let spotlightItem = MDItemCreate(nil, resolvedPath as CFString),
       let lastUsedDateTime = MDItemCopyAttribute(spotlightItem, kMDItemLastUsedDate) as? Date {
        // ISO8601DateFormatter produces a standard date string like "2024-03-15T10:30:00Z".
        lastUsedDate = ISO8601DateFormatter().string(from: lastUsedDateTime)
    }

    resolvedItems.append(RecentItem(
        name: fileName,
        path: resolvedPath,
        order: listPosition,
        lastUsedDate: lastUsedDate
    ))
}

// JSONEncoder serializes the [RecentItem] array to JSON.
// `.prettyPrinted` adds indentation for readability.
// `.sortedKeys` keeps key order stable across runs (easier to diff/debug).
let jsonEncoder = JSONEncoder()
jsonEncoder.outputFormatting = [.prettyPrinted, .sortedKeys]

if let encodedJSON = try? jsonEncoder.encode(resolvedItems),
   let jsonOutput = String(data: encodedJSON, encoding: .utf8) {
    print(jsonOutput)
} else {
    FileHandle.standardError.write("Failed to encode results to JSON\n".data(using: .utf8)!)
    exit(1)
}
