extends Node
class_name RideAudioSynth

# Procedural wind, tyre hum, and rain audio using AudioStreamGenerator.
# Automatically mutes when the app window loses focus (or when muted with M).

var player: AudioStreamPlayer
var playback: AudioStreamGeneratorPlayback
var rng := RandomNumberGenerator.new()

var speed_ms := 6.0
var rain_amount := 0.0
var muted := false
var focused := true

# Simple one-pole IIR filter states
var lp_wind := 0.0
var hp_wind := 0.0
var lp_tyre := 0.0
var lp_rain := 0.0
var master_gain := 1.0

func _ready() -> void:
	rng.randomize()
	var gen := AudioStreamGenerator.new()
	gen.mix_rate = 22050.0
	gen.buffer_length = 0.12

	player = AudioStreamPlayer.new()
	player.stream = gen
	player.volume_db = -6.0
	add_child(player)
	player.play()
	playback = player.get_stream_playback()

func _notification(what: int) -> void:
	if what == NOTIFICATION_APPLICATION_FOCUS_IN:
		focused = true
	elif what == NOTIFICATION_APPLICATION_FOCUS_OUT:
		focused = false

func set_ride_params(v_ms: float, rain: float) -> void:
	speed_ms = v_ms
	rain_amount = rain

func toggle_mute() -> bool:
	muted = not muted
	return muted

func _process(delta: float) -> void:
	if playback == null:
		return
	var target_master := 1.0 if (focused and not muted) else 0.0
	master_gain = lerpf(master_gain, target_master, minf(1.0, delta * 8.0))

	var frames := playback.get_frames_available()
	if frames <= 0:
		return

	var wind_amp := minf(0.45, (speed_ms * speed_ms / 400.0) * 0.32)
	var wind_cut := clampf((300.0 + speed_ms * 38.0) / 22050.0, 0.01, 0.35)
	var tyre_amp := minf(0.28, (speed_ms / 15.0) * 0.20)
	var rain_amp := rain_amount * 0.16

	for _i in frames:
		var white := rng.randf_range(-1.0, 1.0)
		# Band-ish wind noise
		lp_wind += (white - lp_wind) * wind_cut
		hp_wind += (lp_wind - hp_wind) * (wind_cut * 0.35)
		var wind := (lp_wind - hp_wind) * wind_amp

		# Low tyre hum
		lp_tyre += (white - lp_tyre) * 0.045
		var tyre := lp_tyre * tyre_amp

		# High rain hiss
		lp_rain += (white - lp_rain) * 0.45
		var rain := (white - lp_rain) * rain_amp

		var sample := clampf((wind + tyre + rain) * master_gain, -0.95, 0.95)
		playback.push_frame(Vector2(sample, sample))
