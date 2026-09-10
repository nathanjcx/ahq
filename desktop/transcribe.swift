import Foundation
import Speech

func finish(_ value: [String: String], code: Int32 = 0) -> Never {
    let data = try! JSONSerialization.data(withJSONObject: value)
    FileHandle.standardOutput.write(data)
    exit(code)
}
if CommandLine.arguments.count == 2 && CommandLine.arguments[1] == "--version" {
    finish(["version": "Astra HQ on-device speech 1"])
}
guard CommandLine.arguments.count == 2, FileManager.default.fileExists(atPath: CommandLine.arguments[1]) else {
    finish(["error": "The recording could not be opened."])
}
var task: SFSpeechRecognitionTask?
var recognizer: SFSpeechRecognizer?
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        guard status == .authorized else {
            finish(["error": "Allow Speech Recognition for Astra HQ in macOS System Settings, then try again."])
        }
        recognizer = SFSpeechRecognizer(locale: Locale.current)
        guard let speech = recognizer, speech.isAvailable, speech.supportsOnDeviceRecognition else {
            finish(["error": "On-device speech is unavailable for your Mac’s current language. Enable Dictation for that language in System Settings, or type your announcement."])
        }
        let request = SFSpeechURLRecognitionRequest(url: URL(fileURLWithPath: CommandLine.arguments[1]))
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        request.taskHint = .dictation
        task = speech.recognitionTask(with: request) { result, error in
            if let result = result, result.isFinal {
                finish(["text": result.bestTranscription.formattedString])
            }
            if error != nil {
                finish(["error": "The recording could not be transcribed on this Mac. Check that on-device Dictation is enabled and try again."])
            }
        }
    }
}
Timer.scheduledTimer(withTimeInterval: 75, repeats: false) { _ in
    task?.cancel()
    finish(["error": "Speech recognition timed out. Please try a shorter announcement."])
}
RunLoop.main.run()
