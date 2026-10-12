import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in list where (w[kCGWindowOwnerName as String] as? String) == "Obsidian" && (w[kCGWindowLayer as String] as? Int) == 0 {
  print("pid", w[kCGWindowOwnerPID as String]!, "bounds", w[kCGWindowBounds as String]!)
}
