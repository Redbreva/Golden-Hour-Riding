# Offline Windows speech recognition using built-in .NET System.Speech
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Emit-Json($obj) {
    $json = $obj | ConvertTo-Json -Compress
    [Console]::Out.WriteLine($json)
    [Console]::Out.Flush()
}

try {
    Add-Type -AssemblyName System.Speech

    $engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine
    $choices = New-Object System.Speech.Recognition.Choices
    $phrases = @(
        "golden", "sun", "sunny", "sunshine", "sunset", "clear", "evening",
        "overcast", "cloud", "clouds", "cloudy", "grey", "gray",
        "rain", "raining", "rainy", "storm", "wet",
        "mist", "misty", "fog", "foggy",
        "starry", "stars", "night", "painting", "van gogh",
        "snow", "snowing", "snowy", "christmas",
        "skip", "forward", "ahead", "back",
        "hide", "hidden", "show", "info", "display",
        "easier", "easy", "lighter", "less", "ease", "gear down", "shift down", "lower gear", "down a gear",
        "harder", "hard", "heavier", "more", "tougher", "gear up", "shift up", "higher gear", "up a gear",
        "flat", "no hills", "hills off",
        "full", "real hills", "all of it"
    )
    $choices.Add($phrases)

    $gb = New-Object System.Speech.Recognition.GrammarBuilder
    $gb.Append($choices)
    $grammar = New-Object System.Speech.Recognition.Grammar($gb)
    $engine.LoadGrammar($grammar)
    $engine.SetInputToDefaultAudioDevice()

    Emit-Json @{ status = "listening" }

    while ($true) {
        $result = $engine.Recognize([TimeSpan]::FromSeconds(2))
        if ($null -ne $result -and $result.Confidence -ge 0.55) {
            Emit-Json @{ transcript = $result.Text }
        }
    }
} catch {
    Emit-Json @{ error = $_.Exception.Message }
    exit 1
}
