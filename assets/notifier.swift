import Foundation
import UserNotifications
import AppKit

// argv: title body [url] — posts one notification; a click opens url (claude-cli://… or an app URL).
// Stays resident until the notification is acted on or 10 minutes pass. Exit 2 when the user has
// not allowed notifications from this app, so the caller can say so.
let args = CommandLine.arguments
guard args.count > 2 else { exit(0) }          // relaunched with no arguments (Notification Center click after exit): do nothing
let title = args[1], body = args[2]
let url = args.count > 3 ? args[3] : ""

final class Delegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        if let s = r.notification.request.content.userInfo["url"] as? String, let u = URL(string: s) {
            NSWorkspace.shared.open(u)
        }
        done(); exit(0)
    }
    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list, .sound])
    }
}
let delegate = Delegate()
let center = UNUserNotificationCenter.current()
center.delegate = delegate
var code: Int32 = 0
let stateFile = NSString(string: "~/.agentmail/notify-state").expandingTildeInPath
center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
    try? (granted ? "granted" : "denied").write(toFile: stateFile, atomically: true, encoding: .utf8)
    if !granted { FileHandle.standardError.write("not authorized\n".data(using: .utf8)!); code = 2; exit(2) }
    let content = UNMutableNotificationContent()
    content.title = title; content.body = body; content.sound = .default
    if !url.isEmpty { content.userInfo = ["url": url] }
    center.add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) { e in
        if let e = e { FileHandle.standardError.write("add: \(e)\n".data(using: .utf8)!); exit(1) }
    }
}
// keep the process alive so the click reaches the delegate
DispatchQueue.main.asyncAfter(deadline: .now() + 600) { exit(code) }
RunLoop.main.run()
