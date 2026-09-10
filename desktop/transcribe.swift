import Foundation
import AVFoundation
import Speech

func finish(_ value: [String: String], code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    exit(code)
}
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--version" {
    finish(["version": "Astra HQ on-device speech 2"])
}
let speechUsageDescription = Bundle.main.object(forInfoDictionaryKey: "NSSpeechRecognitionUsageDescription") as? String
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--diagnostics" {
    // Build verification must not request microphone or Speech Recognition access.
    let authorizationStatus: String
    switch SFSpeechRecognizer.authorizationStatus() {
    case .authorized: authorizationStatus = "authorized"
    case .denied: authorizationStatus = "denied"
    case .restricted: authorizationStatus = "restricted"
    case .notDetermined: authorizationStatus = "notDetermined"
    @unknown default: authorizationStatus = "unknown"
    }
    finish([
        "version": "Astra HQ on-device speech 2",
        "bundleIdentifier": Bundle.main.bundleIdentifier ?? "",
        "speechUsageDescription": speechUsageDescription ?? "",
        "authorizationStatus": authorizationStatus
    ])
}
guard CommandLine.arguments.count == 2, FileManager.default.fileExists(atPath: CommandLine.arguments[1]) else {
    finish(["error": "The recording could not be opened."])
}
let audioURL = URL(fileURLWithPath: CommandLine.arguments[1])
do {
    let audio = try AVAudioFile(forReading: audioURL)
    guard audio.length > 0 else {
        finish(["error": "The recording is empty. Hold Announce and speak a short sentence, then release."])
    }
} catch {
    finish(["error": "The recording could not be read. Please record your announcement again."])
}
guard let usage = speechUsageDescription, !usage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
    finish(["error": "This build is missing its macOS Speech Recognition permission description. Rebuild or reinstall Astra HQ, then try again."])
}
var task: SFSpeechRecognitionTask?
var recognizer: SFSpeechRecognizer?
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        switch status {
        case .authorized:
            break
        case .restricted:
            finish(["error": "Speech Recognition is restricted on this Mac. You can still type your announcement."])
        case .denied:
            finish(["error": "Allow Speech Recognition for Astra HQ in System Settings > Privacy & Security > Speech Recognition, then try again."])
        case .notDetermined:
            finish(["error": "Speech Recognition permission was not completed. Please try your announcement again."])
        @unknown default:
            finish(["error": "Speech Recognition permission is unavailable. You can still type your announcement."])
        }
        recognizer = SFSpeechRecognizer(locale: Locale.current)
        guard let speech = recognizer, speech.supportsOnDeviceRecognition else {
            finish(["error": "On-device speech is unavailable for your Mac’s current language. Enable Dictation for that language in System Settings, or type your announcement."])
        }
        guard speech.isAvailable else {
            finish(["error": "Speech Recognition is temporarily unavailable on this Mac. Please try again, or type your announcement."])
        }
        let request = SFSpeechURLRecognitionRequest(url: audioURL)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.taskHint = .dictation
        task = speech.recognitionTask(with: request) { result, error in
            if let result = result, result.isFinal {
                finish(["text": result.bestTranscription.formattedString])
            }
            if let error = error {
                let detail = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
                finish(["error": "The recording could not be transcribed on this Mac: \(detail) Check Keyboard > Dictation in System Settings, then try again."])
            }
        }
    }
}
Timer.scheduledTimer(withTimeInterval: 75, repeats: false) { _ in
    task?.cancel()
    finish(["error": "Speech recognition timed out. Please try a shorter announcement."])
}
RunLoop.main.run()
