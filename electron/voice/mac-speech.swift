import Foundation
import AVFoundation
import Speech

setbuf(stdout, nil)

func emit(_ dict: [String: String]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let line = String(data: data, encoding: .utf8) {
        print(line)
        fflush(stdout)
    }
}

let COMMAND_VOCAB = [
    "golden", "sunny", "sunshine", "sunset", "dusk", "clear",
    "overcast", "cloudy", "clouds", "grey",
    "rain", "raining", "rainy", "storm", "wet",
    "mist", "misty", "fog", "foggy",
    "starry", "stars", "night", "van gogh",
    "snow", "snowing", "snowy", "christmas",
    "skip", "forward", "ahead", "back",
    "hide", "hidden", "show", "info", "display",
    "easier", "easy", "lighter", "gear down", "shift down", "lower gear",
    "harder", "hard", "heavier", "gear up", "shift up", "higher gear",
    "flat", "no hills", "hills off",
    "full", "real hills",
    "light", "light on", "light off", "headlight", "headlight on", "headlight off",
    "mute", "unmute", "sound off", "sound on"
]

final class NativeVoiceListener {
    private let audioEngine = AVAudioEngine()
    private let recognizer: SFSpeechRecognizer?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var stopped = false
    private var emittedCount = 0
    private var lastTail = ""

    init() {
        self.recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-GB")) ?? SFSpeechRecognizer()
    }

    func start() {
        guard let recognizer = recognizer else {
            emit(["error": "Speech recognizer unavailable"])
            exit(1)
        }

        SFSpeechRecognizer.requestAuthorization { status in
            switch status {
            case .authorized:
                self.checkMicrophoneAndRun(recognizer: recognizer)
            case .denied:
                emit(["error": "Speech permission denied"])
                exit(1)
            case .restricted:
                emit(["error": "Speech restricted"])
                exit(1)
            case .notDetermined:
                emit(["error": "Speech permission needed"])
                exit(1)
            @unknown default:
                emit(["error": "Speech unavailable"])
                exit(1)
            }
        }
    }

    private func checkMicrophoneAndRun(recognizer: SFSpeechRecognizer) {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            DispatchQueue.main.async { self.beginAudio(recognizer: recognizer) }
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                if granted {
                    DispatchQueue.main.async { self.beginAudio(recognizer: recognizer) }
                } else {
                    emit(["error": "Mic permission denied"])
                    exit(1)
                }
            }
        default:
            emit(["error": "Mic permission denied"])
            exit(1)
        }
    }

    private func beginAudio(recognizer: SFSpeechRecognizer) {
        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)
        guard format.channelCount > 0 else {
            emit(["error": "No mic input"])
            exit(1)
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            emit(["error": "Audio failed"])
            exit(1)
        }

        emit(["status": "listening"])
        startRecognitionSegment(recognizer: recognizer)
    }

    private func startRecognitionSegment(recognizer: SFSpeechRecognizer) {
        if stopped { return }
        task?.cancel()
        task = nil

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.taskHint = .dictation
        req.contextualStrings = COMMAND_VOCAB
        if #available(macOS 10.15, *), recognizer.supportsOnDeviceRecognition {
            req.requiresOnDeviceRecognition = true
        }
        self.request = req
        self.emittedCount = 0
        self.lastTail = ""

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self, !self.stopped else { return }
            if let result = result {
                let words = result.bestTranscription.formattedString
                    .split(whereSeparator: { $0.isWhitespace })
                    .map(String.init)

                if !words.isEmpty {
                    // Always inspect the most recent 1-3 words so revised partial hypotheses
                    // (e.g. "ray" -> "rain") are still emitted cleanly.
                    let startIdx = max(0, min(self.emittedCount, words.count - 1))
                    let tailSlice = words[startIdx...].suffix(3)
                    let tail = tailSlice.joined(separator: " ")
                    if tail != self.lastTail && !tail.isEmpty {
                        self.lastTail = tail
                        emit(["transcript": tail])
                    }
                    // Advance watermark once there are multiple words so old commands don't linger
                    if words.count > self.emittedCount + 1 {
                        self.emittedCount = words.count - 1
                    }
                }

                if result.isFinal {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                        self.startRecognitionSegment(recognizer: recognizer)
                    }
                }
            } else if error != nil {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.startRecognitionSegment(recognizer: recognizer)
                }
            }
        }
    }

    func stop() {
        stopped = true
        task?.cancel()
        request?.endAudio()
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }
    }
}

let listener = NativeVoiceListener()

signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)
let termSrc = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
termSrc.setEventHandler {
    listener.stop()
    exit(0)
}
termSrc.resume()

let intSrc = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
intSrc.setEventHandler {
    listener.stop()
    exit(0)
}
intSrc.resume()

listener.start()
RunLoop.main.run()
