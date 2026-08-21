import Foundation
import UserNotifications

// argv: title body — posts one notification and exits when delivered/denied.
let args = CommandLine.arguments
let title = args.count > 1 ? args[1] : "notification"
let body  = args.count > 2 ? args[2] : ""
let sem = DispatchSemaphore(value: 0)
let center = UNUserNotificationCenter.current()
center.requestAuthorization(options: [.alert, .sound]) { granted, err in
    if !granted { FileHandle.standardError.write("not authorized\n".data(using: .utf8)!); sem.signal(); return }
    let c = UNMutableNotificationContent()
    c.title = title
    c.body = body
    let req = UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil)
    center.add(req) { e in
        if let e = e { FileHandle.standardError.write("add: \(e)\n".data(using: .utf8)!) }
        sem.signal()
    }
}
_ = sem.wait(timeout: .now() + 15)
