extends Node3D

# Golden Hour Riding — Godot 4 Forward+ Realism Build
# Features: Physical Sky, Volumetric Fog god-rays, SDFGI, SSAO/SSIL,
# CC0 Poly Haven photogrammetry 3D fir trees, ferns & boulders,
# PBR terrain/asphalt/shoulders, backlit wind-swaying grass & wildflowers,
# sunlit cloud layer, GPU rain, detailed 3D cockpit with live GPS screen, and procedural audio.

const RIDER_MASS := 80.0
const GRAVITY := 9.81
const CRR := 0.004
const RHO := 1.2
const CDA := 0.32
const LANE_OFFSET := -1.75

const TERRAIN_SIZE := 2400.0
const TERRAIN_CELLS := 160

@onready var sun_light: DirectionalLight3D = $SunLight
@onready var world_env: WorldEnvironment = $WorldEnvironment
@onready var camera: Camera3D = $RiderCamera
@onready var hud_power: Label = $HUD/BottomLeft/PowerBox/Val
@onready var hud_speed: Label = $HUD/BottomLeft/SpeedBox/Val
@onready var hud_grade: Label = $HUD/BottomLeft/GradeBox/Val
@onready var hud_dist: Label = $HUD/BottomLeft/DistBox/Val
@onready var hud_preset: Label = $HUD/TopRight/PresetLabel
@onready var hud_root: Control = $HUD

var road_points: PackedVector3Array = PackedVector3Array()
var road_tangents: PackedVector3Array = PackedVector3Array()
var road_rights: PackedVector3Array = PackedVector3Array()
var road_length := 0.0
var sample_count := 0

var height_grid: PackedFloat32Array = PackedFloat32Array()
var road_mat: ShaderMaterial
var cloud_mat: ShaderMaterial
var rain_particles: GPUParticles3D
var audio_synth: RideAudioSynth

# Live cockpit GPS SubViewport labels
var gps_speed_lbl: Label
var gps_power_lbl: Label
var gps_grade_lbl: Label

# Spatial hash for fast nearest-road queries
var road_grid: Dictionary = {}
const HASH_CELL := 48.0

# Ride state
var dist_s := 0.0
var speed_ms := 7.0
var power_w := 220.0
var target_power_w := 220.0
var total_dist := 0.0
var grade_pct := 0.0
var lean_rad := 0.0
var pedal_phase := 0.0
var rain_amount := 0.0
var wheel_node: Node3D
var headlight: SpotLight3D
var headlight_on := false
var sun_flat := Vector3(-0.4, 0.0, -0.9).normalized()

var presets := [
	{
		"name": "Golden Hour (1)", "elev": 11.0, "az": -26.0,
		"sun_col": Color(1.0, 0.78, 0.55), "sun_e": 3.2,
		"fog_d": 0.0020, "fog_a": 0.56, "fog_col": Color(0.95, 0.80, 0.64),
		"cloud_cov": 0.50, "cloud_op": 0.78, "cloud_lit": Color(1.0, 0.82, 0.60), "cloud_dark": Color(0.36, 0.39, 0.50),
		"wet": 0.20, "rain": 0.0,
	},
	{
		"name": "Deep Sunset (2)", "elev": 5.5, "az": -20.0,
		"sun_col": Color(1.0, 0.62, 0.38), "sun_e": 2.4,
		"fog_d": 0.0026, "fog_a": 0.64, "fog_col": Color(0.92, 0.64, 0.48),
		"cloud_cov": 0.54, "cloud_op": 0.84, "cloud_lit": Color(1.0, 0.64, 0.40), "cloud_dark": Color(0.28, 0.27, 0.38),
		"wet": 0.24, "rain": 0.0,
	},
	{
		"name": "Misty Dawn (3)", "elev": 14.0, "az": -38.0,
		"sun_col": Color(1.0, 0.88, 0.74), "sun_e": 2.6,
		"fog_d": 0.011, "fog_a": 0.52, "fog_col": Color(0.84, 0.82, 0.78),
		"cloud_cov": 0.36, "cloud_op": 0.52, "cloud_lit": Color(0.96, 0.88, 0.76), "cloud_dark": Color(0.52, 0.54, 0.60),
		"wet": 0.38, "rain": 0.0,
	},
	{
		"name": "Rain (4)", "elev": 26.0, "az": -24.0,
		"sun_col": Color(0.76, 0.81, 0.88), "sun_e": 0.85,
		"fog_d": 0.0070, "fog_a": 0.22, "fog_col": Color(0.52, 0.56, 0.62),
		"cloud_cov": 0.86, "cloud_op": 0.94, "cloud_lit": Color(0.58, 0.61, 0.67), "cloud_dark": Color(0.30, 0.33, 0.38),
		"wet": 0.85, "rain": 1.0,
	},
	{
		"name": "Overcast (5)", "elev": 32.0, "az": -24.0,
		"sun_col": Color(0.88, 0.91, 0.96), "sun_e": 1.25,
		"fog_d": 0.0036, "fog_a": 0.20, "fog_col": Color(0.70, 0.74, 0.80),
		"cloud_cov": 0.80, "cloud_op": 0.90, "cloud_lit": Color(0.78, 0.81, 0.85), "cloud_dark": Color(0.46, 0.49, 0.55),
		"wet": 0.30, "rain": 0.0,
	},
]
var current_preset := 0

func _ready() -> void:
	audio_synth = RideAudioSynth.new()
	add_child(audio_synth)

	_build_clouds()
	_build_rain_particles()
	_apply_preset(0)
	_build_road_curve()
	_build_terrain()
	_build_road_and_shoulders()
	_build_photogrammetry_forest()
	_build_boulders_and_ferns()
	_build_roadside_grass_and_flowers()
	_build_verge_posts()
	_build_cockpit()

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed:
		match event.keycode:
			KEY_UP:
				target_power_w = minf(900.0, target_power_w + 15.0)
			KEY_DOWN:
				target_power_w = maxf(0.0, target_power_w - 15.0)
			KEY_RIGHT:
				dist_s = fposmod(dist_s + 250.0, road_length)
			KEY_LEFT:
				dist_s = fposmod(dist_s - 250.0, road_length)
			KEY_1:
				_apply_preset(0)
			KEY_2:
				_apply_preset(1)
			KEY_3:
				_apply_preset(2)
			KEY_4:
				_apply_preset(3)
			KEY_5:
				_apply_preset(4)
			KEY_M:
				var is_muted := audio_synth.toggle_mute()
				_update_top_label(is_muted)
			KEY_L:
				headlight_on = not headlight_on
				if headlight:
					headlight.visible = headlight_on
				_update_top_label(audio_synth.muted if audio_synth else false)
			KEY_H:
				hud_root.visible = not hud_root.visible
			KEY_ESCAPE:
				get_tree().quit()

func _update_top_label(is_muted := false) -> void:
	var p: Dictionary = presets[current_preset]
	var snd := "  |  Muted" if is_muted else ""
	var lgt := "  |  Light ON" if headlight_on else ""
	hud_preset.text = p["name"] + "  |  ↑↓ Power  ←→ Skip  1-5 Weather  L Light  M Sound  H Hide" + lgt + snd

func _apply_preset(idx: int) -> void:
	current_preset = idx
	var p: Dictionary = presets[idx]
	sun_light.rotation_degrees = Vector3(-p["elev"], p["az"], 0.0)
	sun_light.light_color = p["sun_col"]
	sun_light.light_energy = p["sun_e"]
	var env: Environment = world_env.environment
	env.volumetric_fog_density = p["fog_d"]
	env.volumetric_fog_anisotropy = p["fog_a"]
	env.volumetric_fog_albedo = p["fog_col"]
	rain_amount = p["rain"]
	if rain_particles:
		rain_particles.emitting = rain_amount > 0.05
	if road_mat:
		road_mat.set_shader_parameter("wetness", p["wet"])
	var sun_fwd := -sun_light.global_transform.basis.z
	sun_flat = Vector3(sun_fwd.x, 0.0, sun_fwd.z).normalized()
	if cloud_mat:
		cloud_mat.set_shader_parameter("sun_dir", -sun_fwd)
		cloud_mat.set_shader_parameter("coverage", p["cloud_cov"])
		cloud_mat.set_shader_parameter("opacity", p["cloud_op"])
		cloud_mat.set_shader_parameter("lit_color", p["cloud_lit"])
		cloud_mat.set_shader_parameter("dark_color", p["cloud_dark"])
	_update_top_label(audio_synth.muted if audio_synth else false)

func _hash2(x: float, y: float) -> float:
	var n := sin(x * 127.1 + y * 311.7) * 43758.5453
	return n - floorf(n)

func _vnoise(x: float, y: float) -> float:
	var xi := floorf(x)
	var yi := floorf(y)
	var xf := x - xi
	var yf := y - yi
	var u := xf * xf * (3.0 - 2.0 * xf)
	var v := yf * yf * (3.0 - 2.0 * yf)
	var a := _hash2(xi, yi)
	var b := _hash2(xi + 1.0, yi)
	var c := _hash2(xi, yi + 1.0)
	var d := _hash2(xi + 1.0, yi + 1.0)
	return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v

func _fbm(x: float, y: float, octaves := 5) -> float:
	var s := 0.0
	var a := 0.5
	var f := 1.0
	for _i in octaves:
		s += a * _vnoise(x * f, y * f)
		f *= 2.03
		a *= 0.5
	return s

func _ridged(x: float, y: float, octaves := 4) -> float:
	var s := 0.0
	var a := 0.5
	var f := 1.0
	var prev := 1.0
	for _i in octaves:
		var n := 1.0 - absf(2.0 * _vnoise(x * f, y * f) - 1.0)
		n *= n
		s += n * a * prev
		prev = n
		f *= 2.1
		a *= 0.5
	return s

func _build_clouds() -> void:
	var plane := PlaneMesh.new()
	plane.size = Vector2(16000.0, 16000.0)
	cloud_mat = ShaderMaterial.new()
	cloud_mat.shader = load("res://shaders/clouds.gdshader")
	var mi := MeshInstance3D.new()
	mi.mesh = plane
	mi.material_override = cloud_mat
	mi.position = Vector3(0.0, 1350.0, 0.0)
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)

func _build_rain_particles() -> void:
	rain_particles = GPUParticles3D.new()
	rain_particles.amount = 3500
	rain_particles.lifetime = 0.75
	rain_particles.emitting = false
	rain_particles.visibility_aabb = AABB(Vector3(-24, -16, -24), Vector3(48, 32, 48))

	var pmat := ParticleProcessMaterial.new()
	pmat.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pmat.emission_box_extents = Vector3(16.0, 1.0, 18.0)
	pmat.direction = Vector3(0.1, -1.0, 0.05)
	pmat.spread = 3.0
	pmat.initial_velocity_min = 18.0
	pmat.initial_velocity_max = 24.0
	pmat.gravity = Vector3(0.0, -9.8, 0.0)
	rain_particles.process_material = pmat

	var streak := QuadMesh.new()
	streak.size = Vector2(0.005, 0.36)
	var smat := StandardMaterial3D.new()
	smat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	smat.albedo_color = Color(0.84, 0.90, 0.98, 0.16)
	smat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	smat.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	streak.material = smat
	rain_particles.draw_pass_1 = streak
	rain_particles.position = Vector3(0.0, 10.0, -8.0)
	camera.add_child(rain_particles)

func _build_road_curve() -> void:
	var curve := Curve3D.new()
	var n_ctrl := 22
	var ctrl: Array[Vector3] = []
	for i in n_ctrl:
		var a := (float(i) / float(n_ctrl)) * TAU
		var r := 380.0 + 95.0 * sin(a * 3.0 + 0.6) + 52.0 * sin(a * 5.0 + 2.1)
		var y := 38.0 + 16.0 * sin(a * 2.0 + 1.0) + 4.5 * sin(a * 5.0)
		ctrl.append(Vector3(cos(a) * r, y, sin(a) * r))

	for i in n_ctrl:
		var p_prev := ctrl[(i - 1 + n_ctrl) % n_ctrl]
		var p_curr := ctrl[i]
		var p_next := ctrl[(i + 1) % n_ctrl]
		var tan_v := (p_next - p_prev) * 0.18
		curve.add_point(p_curr, -tan_v, tan_v)
	curve.add_point(ctrl[0], -(ctrl[1] - ctrl[n_ctrl - 1]) * 0.18, (ctrl[1] - ctrl[n_ctrl - 1]) * 0.18)

	road_length = curve.get_baked_length()
	sample_count = int(road_length / 2.0)
	road_points.resize(sample_count)
	road_tangents.resize(sample_count)
	road_rights.resize(sample_count)

	for i in sample_count:
		road_points[i] = curve.sample_baked((float(i) / float(sample_count)) * road_length)

	for i in sample_count:
		var t := (road_points[(i + 1) % sample_count] - road_points[(i - 1 + sample_count) % sample_count]).normalized()
		road_tangents[i] = t
		road_rights[i] = Vector3(-t.z, 0.0, t.x).normalized()
		var key := Vector2i(floori(road_points[i].x / HASH_CELL), floori(road_points[i].z / HASH_CELL))
		if not road_grid.has(key):
			road_grid[key] = PackedInt32Array()
		var arr: PackedInt32Array = road_grid[key]
		arr.append(i)
		road_grid[key] = arr

func _nearest_road(x: float, z: float) -> Dictionary:
	var cx := floori(x / HASH_CELL)
	var cz := floori(z / HASH_CELL)
	var best_d2 := 1e12
	var best_i := -1
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var key := Vector2i(cx + dx, cz + dz)
			if not road_grid.has(key):
				continue
			var arr: PackedInt32Array = road_grid[key]
			for i in arr:
				var ex := x - road_points[i].x
				var ez := z - road_points[i].z
				var d2 := ex * ex + ez * ez
				if d2 < best_d2:
					best_d2 = d2
					best_i = i
	if best_i < 0:
		return {"found": false, "d": 999.0, "y": 0.0}
	var ex := x - road_points[best_i].x
	var ez := z - road_points[best_i].z
	var proj := ex * road_tangents[best_i].x + ez * road_tangents[best_i].z
	return {
		"found": true,
		"d": sqrt(best_d2),
		"y": road_points[best_i].y + road_tangents[best_i].y * proj
	}

func _terrain_height(x: float, z: float) -> float:
	var r := maxf(1.0, sqrt(x * x + z * z))
	var h := 38.0 + (_fbm(x / 260.0 + 5.0, z / 260.0 + 9.0, 5) - 0.5) * 95.0 + (_fbm(x / 55.0, z / 55.0, 3) - 0.5) * 12.0
	var gap := smoothstep(0.55, 0.95, (x * sun_flat.x + z * sun_flat.z) / r)
	h += (_ridged(x / 110.0 + 7.0, z / 110.0 + 3.0, 3) - 0.25) * 14.0
	var mtn := smoothstep(560.0, 1150.0, r) * (1.0 - 0.9 * gap)
	h += mtn * (80.0 + _fbm(x / 360.0 + 40.0, z / 360.0, 4) * 320.0 + _ridged(x / 240.0 + 11.0, z / 240.0 + 5.0, 4) * 260.0)
	var nr := _nearest_road(x, z)
	if nr["found"]:
		var k := smoothstep(9.0, 52.0, nr["d"])
		return (nr["y"] - 0.95) * (1.0 - k) + h * k
	return h

func _mesh_height(x: float, z: float) -> float:
	var step := TERRAIN_SIZE / float(TERRAIN_CELLS)
	var w := TERRAIN_CELLS + 1
	var fx := (x + TERRAIN_SIZE * 0.5) / step
	var fz := (z + TERRAIN_SIZE * 0.5) / step
	var ix := clampi(floori(fx), 0, TERRAIN_CELLS - 1)
	var iz := clampi(floori(fz), 0, TERRAIN_CELLS - 1)
	var u := clampf(fx - float(ix), 0.0, 1.0)
	var v := clampf(fz - float(iz), 0.0, 1.0)
	var a := height_grid[iz * w + ix]
	var b := height_grid[(iz + 1) * w + ix]
	var c := height_grid[(iz + 1) * w + ix + 1]
	var d := height_grid[iz * w + ix + 1]
	return lerpf(lerpf(a, d, u), lerpf(b, c, u), v)

func _build_terrain() -> void:
	var w := TERRAIN_CELLS + 1
	var step := TERRAIN_SIZE / float(TERRAIN_CELLS)
	height_grid.resize(w * w)

	var verts := PackedVector3Array()
	verts.resize(w * w)
	for iz in w:
		var z := -TERRAIN_SIZE * 0.5 + float(iz) * step
		for ix in w:
			var x := -TERRAIN_SIZE * 0.5 + float(ix) * step
			var idx := iz * w + ix
			var h := _terrain_height(x, z)
			height_grid[idx] = h
			verts[idx] = Vector3(x, h, z)

	var normals := PackedVector3Array()
	normals.resize(w * w)
	var two_step := step * 2.0
	for iz in w:
		var izm := maxi(0, iz - 1)
		var izp := mini(TERRAIN_CELLS, iz + 1)
		for ix in w:
			var ixm := maxi(0, ix - 1)
			var ixp := mini(TERRAIN_CELLS, ix + 1)
			var hl := height_grid[iz * w + ixm]
			var hr := height_grid[iz * w + ixp]
			var hd := height_grid[izm * w + ix]
			var hu := height_grid[izp * w + ix]
			normals[iz * w + ix] = Vector3(hl - hr, two_step, hd - hu).normalized()

	var indices := PackedInt32Array()
	indices.resize(TERRAIN_CELLS * TERRAIN_CELLS * 6)
	var q := 0
	for iz in TERRAIN_CELLS:
		for ix in TERRAIN_CELLS:
			var a := iz * w + ix
			var b := a + 1
			var c := a + w
			var d := c + 1
			indices[q] = a; indices[q + 1] = b; indices[q + 2] = c
			indices[q + 3] = b; indices[q + 4] = d; indices[q + 5] = c
			q += 6

	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = verts
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_INDEX] = indices

	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)

	var mat := ShaderMaterial.new()
	mat.shader = load("res://shaders/terrain.gdshader")
	mat.set_shader_parameter("grass_albedo", load("res://assets/textures/leafy_grass_diff_2k.jpg"))
	mat.set_shader_parameter("grass_normal", load("res://assets/textures/leafy_grass_nor_gl_1k.jpg"))
	mat.set_shader_parameter("rock_albedo", load("res://assets/textures/rock_face_03_diff_1k.jpg"))

	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	add_child(mi)

func _build_ribbon(off_a: float, dy_a: float, off_b: float, dy_b: float, u_a: float, u_b: float) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in sample_count:
		var j := (i + 1) % sample_count
		var p0 := road_points[i]
		var p1 := road_points[j]
		var r0 := road_rights[i]
		var r1 := road_rights[j]
		var v0 := float(i) * 2.0
		var v1 := float(i + 1) * 2.0

		var a := p0 + r0 * off_a + Vector3(0.0, dy_a, 0.0)
		var b := p0 + r0 * off_b + Vector3(0.0, dy_b, 0.0)
		var c := p1 + r1 * off_a + Vector3(0.0, dy_a, 0.0)
		var d := p1 + r1 * off_b + Vector3(0.0, dy_b, 0.0)

		st.set_uv(Vector2(u_a, v0)); st.add_vertex(a)
		st.set_uv(Vector2(u_a, v1)); st.add_vertex(c)
		st.set_uv(Vector2(u_b, v0)); st.add_vertex(b)

		st.set_uv(Vector2(u_b, v0)); st.add_vertex(b)
		st.set_uv(Vector2(u_a, v1)); st.add_vertex(c)
		st.set_uv(Vector2(u_b, v1)); st.add_vertex(d)
	st.generate_normals()
	st.generate_tangents()
	return st.commit()

func _build_road_and_shoulders() -> void:
	road_mat = ShaderMaterial.new()
	road_mat.shader = load("res://shaders/road.gdshader")
	road_mat.set_shader_parameter("asphalt_albedo", load("res://assets/textures/asphalt_02_diff_2k.jpg"))
	road_mat.set_shader_parameter("asphalt_normal", load("res://assets/textures/asphalt_02_nor_gl_2k.jpg"))
	road_mat.set_shader_parameter("wetness", 0.28)

	var road_mi := MeshInstance3D.new()
	road_mi.mesh = _build_ribbon(-3.5, 0.0, 3.5, 0.0, 0.0, 1.0)
	road_mi.material_override = road_mat
	add_child(road_mi)

	var sh_mat := ShaderMaterial.new()
	sh_mat.shader = load("res://shaders/shoulder.gdshader")
	sh_mat.set_shader_parameter("gravel_albedo", load("res://assets/textures/gravel_ground_01_diff_1k.jpg"))
	sh_mat.set_shader_parameter("grass_albedo", load("res://assets/textures/leafy_grass_diff_2k.jpg"))

	for strip in [
		_build_ribbon(-7.0, -0.72, -3.48, 0.004, 1.0, 0.0),
		_build_ribbon(3.48, 0.004, 7.0, -0.72, 0.0, 1.0),
	]:
		var sh_mi := MeshInstance3D.new()
		sh_mi.mesh = strip
		sh_mi.material_override = sh_mat
		add_child(sh_mi)

func _collect_gltf_parts(node: Node, parent_xform: Transform3D, out: Array[Dictionary]) -> void:
	var xform := parent_xform
	if node is Node3D:
		xform = parent_xform * (node as Node3D).transform
	if node is MeshInstance3D:
		var mi := node as MeshInstance3D
		if mi.mesh != null:
			out.append({"mesh": mi.mesh, "xform": xform})
	for child in node.get_children():
		_collect_gltf_parts(child, xform, out)

func _load_gltf_parts(res_path: String) -> Dictionary:
	var packed := load(res_path) as PackedScene
	if packed == null:
		return {"parts": [], "height": 1.0, "min_y": 0.0}
	var root := packed.instantiate()
	var parts: Array[Dictionary] = []
	_collect_gltf_parts(root, Transform3D.IDENTITY, parts)
	var min_y := 1e9
	var max_y := -1e9
	for part in parts:
		var aabb: AABB = (part["mesh"] as Mesh).get_aabb()
		var xf: Transform3D = part["xform"]
		var p0 := xf * aabb.position
		var p1 := xf * (aabb.position + aabb.size)
		min_y = minf(min_y, minf(p0.y, p1.y))
		max_y = maxf(max_y, maxf(p0.y, p1.y))
	root.queue_free()
	var h := maxf(0.1, max_y - min_y)
	return {"parts": parts, "height": h, "min_y": min_y if min_y < 1e8 else 0.0}

func _scatter_gltf(res_path: String, transforms: Array[Transform3D], target_height: float, cast_shadows := true) -> void:
	if transforms.is_empty():
		return
	var info := _load_gltf_parts(res_path)
	var parts: Array = info["parts"]
	if parts.is_empty():
		return
	var norm_scale := target_height / float(info["height"])
	var base_offset := Vector3(0.0, -float(info["min_y"]) * norm_scale, 0.0)
	var norm_xf := Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * norm_scale), base_offset)

	for part in parts:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = part["mesh"]
		mm.instance_count = transforms.size()
		var local_xf: Transform3D = norm_xf * (part["xform"] as Transform3D)
		for i in transforms.size():
			mm.set_instance_transform(i, transforms[i] * local_xf)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
		if not cast_shadows:
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mmi)

func _make_pine_bough_texture() -> ImageTexture:
	var rng := RandomNumberGenerator.new()
	rng.seed = 505
	var size := 256
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))

	# Helper to stamp a soft dot/stroke into the RGBA8 image
	var stamp := func(cx: float, cy: float, r: int, col: Color) -> void:
		var ix0 := maxi(0, int(cx) - r)
		var ix1 := mini(size - 1, int(cx) + r)
		var iy0 := maxi(0, int(cy) - r)
		var iy1 := mini(size - 1, int(cy) + r)
		for py in range(iy0, iy1 + 1):
			for px in range(ix0, ix1 + 1):
				if (px - cx) * (px - cx) + (py - cy) * (py - cy) <= float(r * r):
					img.set_pixel(px, py, col)

	# Woody central stem
	for x in range(0, 240):
		stamp.call(float(x), 128.0, 2, Color(0.16, 0.11, 0.07, 1.0))

	# Dense spruce needles radiating along both sides of the bough
	for i in range(4, 248, 2):
		var x := float(i)
		var reach := pow(1.0 - x / 260.0, 0.55) * 112.0 * rng.randf_range(0.55, 1.0)
		for sgn: float in [-1.0, 1.0]:
			var lum := rng.randf_range(0.08, 0.22)
			var col := Color(lum * 0.72, lum + 0.08, lum * 0.45, 1.0)
			var ex := x + reach * 0.52 + rng.randf_range(0.0, 8.0)
			var ey := 128.0 + sgn * reach
			var steps := maxi(4, int(reach * 0.45))
			for s in range(steps + 1):
				var t := float(s) / float(steps)
				var px := lerpf(x, ex, t)
				var py := lerpf(128.0, ey, t) + sgn * sin(t * PI) * reach * 0.12
				stamp.call(px, py, 1, col)

	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

func _make_grass_tuft_texture() -> ImageTexture:
	var rng := RandomNumberGenerator.new()
	rng.seed = 404
	var size := 256
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))

	for _b in 42:
		var bx := rng.randf_range(18.0, 238.0)
		var bh := rng.randf_range(115.0, 242.0)
		var lean := rng.randf_range(-52.0, 52.0)
		var bw := rng.randf_range(3.0, 6.0)
		var golden_tip := rng.randf() < 0.45
		var c_root := Color(0.14, 0.22, 0.06, 1.0)
		var c_mid := Color(0.32, 0.44, 0.13, 1.0)
		var c_tip := Color(0.76, 0.68, 0.34, 1.0) if golden_tip else Color(0.50, 0.58, 0.20, 1.0)
		var steps := int(bh)
		for s in range(steps):
			var t := float(s) / float(steps)
			var py := 255 - s
			var px_c := bx + lean * (t * t)
			var half_w := bw * (1.0 - t * 0.88) * 0.5
			var col := c_root.lerp(c_mid, minf(1.0, t * 1.6)) if t < 0.6 else c_mid.lerp(c_tip, (t - 0.6) / 0.4)
			var x0 := maxi(0, int(px_c - half_w))
			var x1 := mini(size - 1, int(px_c + half_w))
			for px in range(x0, x1 + 1):
				img.set_pixel(px, py, col)

	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

func _build_photogrammetry_forest() -> void:
	# Organic alpine conifer trees built from whorls of alpha-cutout spruce needle boughs
	var rng := RandomNumberGenerator.new()
	rng.seed = 1337
	var spots: Array[Transform3D] = []
	var colors: Array[Color] = []

	for _n in 32000:
		if spots.size() >= 2800:
			break
		var x := (rng.randf() - 0.5) * TERRAIN_SIZE * 0.78
		var z := (rng.randf() - 0.5) * TERRAIN_SIZE * 0.78
		var nr := _nearest_road(x, z)
		if nr["d"] < 10.5:
			continue
		var forest := _fbm(x / 130.0 + 3.0, z / 130.0 + 7.0, 3)
		if not (forest > 0.50 or (nr["d"] < 58.0 and rng.randf() < 0.16)):
			continue
		var y := _mesh_height(x, z)
		if y > 225.0:
			continue
		var s := rng.randf_range(0.85, 1.85)
		var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s * rng.randf_range(0.85, 1.15), s, s * rng.randf_range(0.85, 1.15)))
		spots.append(Transform3D(b, Vector3(x, y - 0.35, z)))
		colors.append(Color(rng.randf_range(0.70, 1.02), rng.randf_range(0.75, 1.02), rng.randf_range(0.62, 0.92)))

	# Trunks
	var trunk_mesh := CylinderMesh.new()
	trunk_mesh.top_radius = 0.05
	trunk_mesh.bottom_radius = 0.24
	trunk_mesh.height = 10.5
	trunk_mesh.radial_segments = 6
	var trunk_mat := StandardMaterial3D.new()
	trunk_mat.albedo_color = Color(0.20, 0.14, 0.10)
	trunk_mat.roughness = 0.96
	trunk_mesh.material = trunk_mat

	var trunk_mm := MultiMesh.new()
	trunk_mm.transform_format = MultiMesh.TRANSFORM_3D
	trunk_mm.mesh = trunk_mesh
	trunk_mm.instance_count = spots.size()
	for i in spots.size():
		var t := spots[i]
		t.origin.y += 5.25 * t.basis.get_scale().y
		trunk_mm.set_instance_transform(i, t)
	var trunk_node := MultiMeshInstance3D.new()
	trunk_node.multimesh = trunk_mm
	trunk_node.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	add_child(trunk_node)

	# Build a single multi-whorl bough-card foliage mesh (~140 quads per tree)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var add_card := func(ang: float, y: float, length: float, width: float, droop: float, vertical: bool) -> void:
		var ca := cos(ang)
		var sa := sin(ang)
		var cd := cos(droop)
		var sd := sin(droop)
		var nrm := Vector3(ca * 0.72, 0.69, sa * 0.72).normalized()
		var corners := [Vector2(0.0, -0.5), Vector2(1.0, -0.5), Vector2(1.0, 0.5), Vector2(0.0, 0.5)]
		var pts: Array[Vector3] = []
		var uvs: Array[Vector2] = []
		for c: Vector2 in corners:
			var yy: float = c.y * width if vertical else 0.0
			var zz: float = 0.0 if vertical else c.y * width
			var xx: float = c.x * length + 0.05
			var rad: float = xx * cd + yy * sd
			var upv: float = -xx * sd + yy * cd
			pts.append(Vector3(rad * ca - zz * sa, y + upv, rad * sa + zz * ca))
			uvs.append(Vector2(c.x, c.y + 0.5))
		for idx_tri in [0, 1, 2, 0, 2, 3]:
			st.set_normal(nrm)
			st.set_uv(uvs[idx_tri])
			st.add_vertex(pts[idx_tri])

	for k in 13:
		var t := float(k) / 12.0
		var y := 2.0 + t * 8.4
		var L := 2.9 * pow(1.0 - t, 0.85) + 0.42
		var droop := 0.48 - t * 1.05
		var a0 := rng.randf() * TAU
		for b in 5:
			var ang := a0 + float(b) * 1.2566 + rng.randf_range(-0.25, 0.25)
			var l := L * rng.randf_range(0.82, 1.16)
			add_card.call(ang, y + rng.randf_range(-0.15, 0.15), l, l * 0.62, droop, false)
			add_card.call(ang, y + rng.randf_range(-0.15, 0.15), l, l * 0.50, droop, true)

	var fol_mesh := st.commit()
	var fol_mat := StandardMaterial3D.new()
	fol_mat.albedo_texture = _make_pine_bough_texture()
	fol_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	fol_mat.alpha_scissor_threshold = 0.4
	fol_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	fol_mat.vertex_color_use_as_albedo = true
	fol_mat.roughness = 0.92
	fol_mat.backlight_enabled = true
	fol_mat.backlight = Color(0.55, 0.40, 0.15)
	fol_mesh.surface_set_material(0, fol_mat)

	var fol_mm := MultiMesh.new()
	fol_mm.transform_format = MultiMesh.TRANSFORM_3D
	fol_mm.use_colors = true
	fol_mm.mesh = fol_mesh
	fol_mm.instance_count = spots.size()
	for i in spots.size():
		fol_mm.set_instance_transform(i, spots[i])
		fol_mm.set_instance_color(i, colors[i])
	var fol_node := MultiMeshInstance3D.new()
	fol_node.multimesh = fol_mm
	fol_node.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	add_child(fol_node)

func _build_boulders_and_ferns() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 2026

	# Photogrammetry mossy boulders on verges & rocky hillsides
	var boulders: Array[Transform3D] = []
	for _i in 120:
		var idx := rng.randi() % sample_count
		var side: float = -1.0 if rng.randf() < 0.5 else 1.0
		var dist := rng.randf_range(5.5, 42.0)
		var pos := road_points[idx] + road_rights[idx] * (side * dist)
		pos.y = _mesh_height(pos.x, pos.z) - 0.25
		var s := rng.randf_range(0.65, 2.2)
		var b := Basis.from_euler(Vector3(rng.randf_range(-0.2, 0.2), rng.randf() * TAU, rng.randf_range(-0.2, 0.2))).scaled(Vector3(s, s * rng.randf_range(0.7, 1.1), s))
		boulders.append(Transform3D(b, pos))
	_scatter_gltf("res://assets/models/boulder_01/boulder_01_1k.gltf", boulders, 1.35, true)

	# Photogrammetry roadside ferns along shaded verges
	var ferns: Array[Transform3D] = []
	for _i in 450:
		var idx := rng.randi() % sample_count
		var side: float = -1.0 if rng.randf() < 0.5 else 1.0
		var dist := rng.randf_range(4.2, 12.0)
		var pos := road_points[idx] + road_rights[idx] * (side * dist)
		var y := _mesh_height(pos.x, pos.z)
		if dist < 7.0:
			y = road_points[idx].y - 0.72 * (dist - 3.5) / 3.5
		pos.y = y - 0.08
		var s := rng.randf_range(0.7, 1.35)
		var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * s)
		ferns.append(Transform3D(b, pos))
	_scatter_gltf("res://assets/models/fern_02/fern_02_1k.gltf", ferns, 0.75, false)

func _build_roadside_grass_and_flowers() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 404

	# Multi-blade alpha-cutout grass tuft geometry with wind & golden backlit shader
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for k in 3:
		var ang := float(k) * PI / 3.0
		var dx := cos(ang) * 0.48
		var dz := sin(ang) * 0.48
		var v0 := Vector3(-dx, 0.0, -dz)
		var v1 := Vector3(dx, 0.0, dz)
		var v2 := Vector3(dx, 0.65, dz)
		var v3 := Vector3(-dx, 0.65, -dz)
		st.set_uv(Vector2(0.0, 1.0)); st.add_vertex(v0)
		st.set_uv(Vector2(1.0, 1.0)); st.add_vertex(v1)
		st.set_uv(Vector2(1.0, 0.0)); st.add_vertex(v2)
		st.set_uv(Vector2(0.0, 1.0)); st.add_vertex(v0)
		st.set_uv(Vector2(1.0, 0.0)); st.add_vertex(v2)
		st.set_uv(Vector2(0.0, 0.0)); st.add_vertex(v3)
	var tuft_mesh := st.commit()
	var grass_mat := ShaderMaterial.new()
	grass_mat.shader = load("res://shaders/grass.gdshader")
	grass_mat.set_shader_parameter("grass_tex", _make_grass_tuft_texture())
	tuft_mesh.surface_set_material(0, grass_mat)

	var grass_count := 22000
	var grass_mm := MultiMesh.new()
	grass_mm.transform_format = MultiMesh.TRANSFORM_3D
	grass_mm.use_colors = true
	grass_mm.mesh = tuft_mesh
	grass_mm.instance_count = grass_count

	for i in grass_count:
		var idx := rng.randi() % sample_count
		var side: float = -1.0 if rng.randf() < 0.5 else 1.0
		var dist := 3.6 + pow(rng.randf(), 1.5) * 14.0
		var jitter := rng.randf_range(-1.0, 1.0)
		var pos := road_points[idx] + road_rights[idx] * (side * dist) + road_tangents[idx] * jitter
		var y := _mesh_height(pos.x, pos.z)
		if dist < 7.0:
			y = road_points[idx].y - 0.72 * (dist - 3.5) / 3.5
		pos.y = y - 0.06
		var h_sc := rng.randf_range(0.65, 1.65)
		var w_sc := rng.randf_range(0.8, 1.4)
		var b := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(w_sc, h_sc, w_sc))
		grass_mm.set_instance_transform(i, Transform3D(b, pos))
		grass_mm.set_instance_color(i, Color.from_hsv(rng.randf_range(0.18, 0.26), rng.randf_range(0.28, 0.48), rng.randf_range(0.75, 1.05)))

	var grass_node := MultiMeshInstance3D.new()
	grass_node.multimesh = grass_mm
	grass_node.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	grass_node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(grass_node)

	# Roadside wildflowers
	var fl_mesh := SphereMesh.new()
	fl_mesh.radius = 0.055
	fl_mesh.height = 0.075
	fl_mesh.radial_segments = 6
	fl_mesh.rings = 4
	var fl_mat := StandardMaterial3D.new()
	fl_mat.vertex_color_use_as_albedo = true
	fl_mat.roughness = 0.78
	fl_mesh.material = fl_mat

	var fl_count := 3200
	var fl_mm := MultiMesh.new()
	fl_mm.transform_format = MultiMesh.TRANSFORM_3D
	fl_mm.use_colors = true
	fl_mm.mesh = fl_mesh
	fl_mm.instance_count = fl_count
	var palette := [
		Color(0.98, 0.84, 0.22),
		Color(0.96, 0.96, 0.90),
		Color(0.92, 0.95, 0.80),
		Color(0.88, 0.56, 0.74),
	]
	for i in fl_count:
		var idx := rng.randi() % sample_count
		var side: float = -1.0 if rng.randf() < 0.5 else 1.0
		var dist := 3.8 + pow(rng.randf(), 1.4) * 8.0
		var pos := road_points[idx] + road_rights[idx] * (side * dist)
		var y := _mesh_height(pos.x, pos.z)
		if dist < 7.0:
			y = road_points[idx].y - 0.72 * (dist - 3.5) / 3.5
		pos.y = y + rng.randf_range(0.18, 0.42)
		fl_mm.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * rng.randf_range(0.7, 1.35)), pos))
		fl_mm.set_instance_color(i, palette[rng.randi() % palette.size()])

	var fl_node := MultiMeshInstance3D.new()
	fl_node.multimesh = fl_mm
	fl_node.gi_mode = GeometryInstance3D.GI_MODE_DISABLED
	fl_node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(fl_node)

func _build_verge_posts() -> void:
	var post_mesh := CylinderMesh.new()
	post_mesh.top_radius = 0.055
	post_mesh.bottom_radius = 0.068
	post_mesh.height = 0.95
	post_mesh.radial_segments = 6
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.36, 0.29, 0.22)
	mat.roughness = 0.95
	post_mesh.material = mat

	var transforms: Array[Transform3D] = []
	for i in range(0, sample_count, 24):
		if _fbm(float(i) / 40.0 + 2.1, 1.3, 2) < 0.44:
			continue
		for side: float in [-1.0, 1.0]:
			var pos: Vector3 = road_points[i] + road_rights[i] * (side * 4.15)
			pos.y += 0.32
			transforms.append(Transform3D(Basis.IDENTITY, pos))

	if transforms.is_empty():
		return
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = post_mesh
	mm.instance_count = transforms.size()
	for i in transforms.size():
		mm.set_instance_transform(i, transforms[i])
	var node := MultiMeshInstance3D.new()
	node.multimesh = mm
	add_child(node)

func _sweep_tube(points: PackedVector3Array, radius: float, radial_segs := 12) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := points.size()
	var rings: Array[PackedVector3Array] = []
	var prev_up := Vector3.UP

	for i in n:
		var t: Vector3
		if i == 0:
			t = (points[1] - points[0]).normalized()
		elif i == n - 1:
			t = (points[n - 1] - points[n - 2]).normalized()
		else:
			t = (points[i + 1] - points[i - 1]).normalized()

		var side := t.cross(prev_up)
		if side.length_squared() < 0.0001:
			side = t.cross(Vector3.FORWARD)
		side = side.normalized()
		var up := side.cross(t).normalized()
		prev_up = up

		var ring := PackedVector3Array()
		ring.resize(radial_segs)
		for k in radial_segs:
			var ang := (float(k) / float(radial_segs)) * TAU
			ring[k] = points[i] + (side * cos(ang) + up * sin(ang)) * radius
		rings.append(ring)

	for i in range(n - 1):
		for k in radial_segs:
			var kn := (k + 1) % radial_segs
			var a := rings[i][k]
			var b := rings[i][kn]
			var c := rings[i + 1][k]
			var d := rings[i + 1][kn]
			st.add_vertex(a); st.add_vertex(c); st.add_vertex(b)
			st.add_vertex(b); st.add_vertex(c); st.add_vertex(d)

	st.generate_normals()
	return st.commit()

func _make_bar_tape_texture() -> ImageTexture:
	var sz := 128
	var img := Image.create(sz, sz, false, Image.FORMAT_RGBA8)
	for y in sz:
		for x in sz:
			var diag := (x + y) % 16
			var v := 0.14
			if diag == 0:
				v = 0.07
			elif diag == 1:
				v = 0.21
			elif (x % 6 == 2) and (y % 6 == 2):
				v = 0.09
			img.set_pixel(x, y, Color(v, v, v + 0.01, 1.0))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)

func _build_cockpit() -> void:
	var rig := Node3D.new()
	rig.position = Vector3(0.0, -0.31, -0.56)
	camera.add_child(rig)

	var carbon := StandardMaterial3D.new()
	carbon.albedo_color = Color(0.16, 0.17, 0.19)
	carbon.roughness = 0.34
	carbon.metallic = 0.42

	var alloy := StandardMaterial3D.new()
	alloy.albedo_color = Color(0.65, 0.68, 0.72)
	alloy.roughness = 0.26
	alloy.metallic = 0.88

	var tape := StandardMaterial3D.new()
	tape.albedo_texture = _make_bar_tape_texture()
	tape.uv1_scale = Vector3(14.0, 2.0, 1.0)
	tape.roughness = 0.78

	var hood_mat := StandardMaterial3D.new()
	hood_mat.albedo_color = Color(0.13, 0.135, 0.15)
	hood_mat.roughness = 0.72
	hood_mat.metallic = 0.08

	var tan_wall := StandardMaterial3D.new()
	tan_wall.albedo_color = Color(0.55, 0.42, 0.26)
	tan_wall.roughness = 0.82

	# Continuous swept compact road drop handlebars (slight ergonomic flare + smooth corners)
	var half_bar := [
		Vector3(0.215, -0.125, 0.055),
		Vector3(0.215, -0.122, -0.042),
		Vector3(0.208, -0.064, -0.102),
		Vector3(0.202, -0.004, -0.086),
		Vector3(0.188, 0.000, -0.022),
		Vector3(0.135, 0.000, 0.000),
		Vector3(0.000, 0.000, 0.000),
	]
	var full_ctrl: Array[Vector3] = []
	for p: Vector3 in half_bar:
		full_ctrl.append(p)
	for i in range(half_bar.size() - 2, -1, -1):
		var p: Vector3 = half_bar[i]
		full_ctrl.append(Vector3(-p.x, p.y, p.z))

	var bar_curve := Curve3D.new()
	for i in full_ctrl.size():
		var p_prev: Vector3 = full_ctrl[maxi(0, i - 1)]
		var p_curr: Vector3 = full_ctrl[i]
		var p_next: Vector3 = full_ctrl[mini(full_ctrl.size() - 1, i + 1)]
		var tv := (p_next - p_prev) * 0.22
		bar_curve.add_point(p_curr, -tv if i > 0 else Vector3.ZERO, tv if i < full_ctrl.size() - 1 else Vector3.ZERO)
	bar_curve.bake_interval = 0.010
	var bar_pts := bar_curve.get_baked_points()

	var bar := MeshInstance3D.new()
	bar.mesh = _sweep_tube(bar_pts, 0.014, 14)
	bar.material_override = tape
	rig.add_child(bar)

	# Unwrapped central carbon clamp section + faceplate
	var center_clamp := MeshInstance3D.new()
	var cc_m := CylinderMesh.new()
	cc_m.top_radius = 0.0165
	cc_m.bottom_radius = 0.0165
	cc_m.height = 0.12
	cc_m.material = carbon
	center_clamp.mesh = cc_m
	center_clamp.rotation_degrees = Vector3(0.0, 0.0, 90.0)
	rig.add_child(center_clamp)

	var stem := MeshInstance3D.new()
	var stem_m := BoxMesh.new()
	stem_m.size = Vector3(0.036, 0.030, 0.12)
	stem_m.material = carbon
	stem.mesh = stem_m
	stem.position = Vector3(0.0, -0.004, 0.055)
	rig.add_child(stem)

	# Sculpted STI-style brake hoods angled naturally forward + curved swept brake levers
	for side: float in [-1.0, 1.0]:
		var hood_pts := PackedVector3Array([
			Vector3(side * 0.200, 0.000, -0.072),
			Vector3(side * 0.198, 0.010, -0.106),
			Vector3(side * 0.195, 0.024, -0.132),
			Vector3(side * 0.192, 0.044, -0.142),
		])
		var hood := MeshInstance3D.new()
		hood.mesh = _sweep_tube(hood_pts, 0.0175, 12)
		hood.material_override = hood_mat
		rig.add_child(hood)

		var cap := MeshInstance3D.new()
		var cap_m := SphereMesh.new()
		cap_m.radius = 0.017
		cap_m.height = 0.034
		cap_m.material = hood_mat
		cap.mesh = cap_m
		cap.position = Vector3(side * 0.192, 0.046, -0.143)
		rig.add_child(cap)

		var lev_pts := PackedVector3Array([
			Vector3(side * 0.196, 0.014, -0.136),
			Vector3(side * 0.200, -0.035, -0.150),
			Vector3(side * 0.198, -0.092, -0.132),
		])
		var lever := MeshInstance3D.new()
		lever.mesh = _sweep_tube(lev_pts, 0.0045, 8)
		lever.material_override = carbon
		rig.add_child(lever)

		var paddle := MeshInstance3D.new()
		var pad_m := BoxMesh.new()
		pad_m.size = Vector3(0.005, 0.040, 0.007)
		pad_m.material = alloy
		paddle.mesh = pad_m
		paddle.position = Vector3(side * 0.189, -0.026, -0.140)
		rig.add_child(paddle)

		var plug := MeshInstance3D.new()
		var plug_m := CylinderMesh.new()
		plug_m.top_radius = 0.014
		plug_m.bottom_radius = 0.014
		plug_m.height = 0.006
		plug_m.material = alloy
		plug.mesh = plug_m
		plug.position = Vector3(side * 0.215, -0.125, 0.057)
		plug.rotation_degrees = Vector3(90.0, 0.0, 0.0)
		rig.add_child(plug)

	# Out-front aero mount + under-mounted toggleable bike headlight (L key)
	headlight = SpotLight3D.new()
	headlight.position = Vector3(0.0, 0.006, -0.10)
	headlight.rotation_degrees = Vector3(-9.0, 0.0, 0.0)
	headlight.light_color = Color(1.0, 0.96, 0.88)
	headlight.light_energy = 14.0
	headlight.spot_range = 65.0
	headlight.spot_angle = 32.0
	headlight.spot_attenuation = 1.2
	headlight.shadow_enabled = false
	headlight.visible = false
	rig.add_child(headlight)

	# Out-front aero mount + live SubViewport GPS cycling computer
	var mount := MeshInstance3D.new()
	var mount_m := BoxMesh.new()
	mount_m.size = Vector3(0.012, 0.008, 0.09)
	mount_m.material = carbon
	mount.mesh = mount_m
	mount.position = Vector3(0.024, 0.012, -0.042)
	mount.rotation_degrees = Vector3(0.0, 14.0, 0.0)
	rig.add_child(mount)

	var unit := Node3D.new()
	unit.position = Vector3(0.0, 0.028, -0.084)
	unit.rotation_degrees = Vector3(22.0, 0.0, 0.0)
	rig.add_child(unit)

	var body := MeshInstance3D.new()
	var body_m := BoxMesh.new()
	body_m.size = Vector3(0.058, 0.012, 0.098)
	body_m.material = carbon
	body.mesh = body_m
	unit.add_child(body)

	# Live SubViewport rendering Speed / Watts / Gradient onto the handlebar GPS screen
	var vp := SubViewport.new()
	vp.size = Vector2i(256, 416)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)

	var bg := ColorRect.new()
	bg.color = Color(0.86, 0.88, 0.83)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	vp.add_child(bg)

	var top_bar := ColorRect.new()
	top_bar.color = Color(0.11, 0.13, 0.15)
	top_bar.size = Vector2(256, 40)
	vp.add_child(top_bar)

	gps_grade_lbl = Label.new()
	gps_grade_lbl.text = "GPS   +0.0%"
	gps_grade_lbl.position = Vector2(14, 7)
	gps_grade_lbl.add_theme_font_size_override("font_size", 22)
	gps_grade_lbl.add_theme_color_override("font_color", Color(0.88, 0.90, 0.85))
	vp.add_child(gps_grade_lbl)

	gps_speed_lbl = Label.new()
	gps_speed_lbl.text = "25"
	gps_speed_lbl.position = Vector2(0, 62)
	gps_speed_lbl.size = Vector2(256, 120)
	gps_speed_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	gps_speed_lbl.add_theme_font_size_override("font_size", 104)
	gps_speed_lbl.add_theme_color_override("font_color", Color(0.08, 0.09, 0.11))
	vp.add_child(gps_speed_lbl)

	var kmh_lbl := Label.new()
	kmh_lbl.text = "KM/H"
	kmh_lbl.position = Vector2(0, 178)
	kmh_lbl.size = Vector2(256, 30)
	kmh_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	kmh_lbl.add_theme_font_size_override("font_size", 22)
	kmh_lbl.add_theme_color_override("font_color", Color(0.28, 0.30, 0.33))
	vp.add_child(kmh_lbl)

	var div_line := ColorRect.new()
	div_line.color = Color(0.12, 0.14, 0.16)
	div_line.position = Vector2(24, 218)
	div_line.size = Vector2(208, 3)
	vp.add_child(div_line)

	gps_power_lbl = Label.new()
	gps_power_lbl.text = "220"
	gps_power_lbl.position = Vector2(0, 238)
	gps_power_lbl.size = Vector2(256, 110)
	gps_power_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	gps_power_lbl.add_theme_font_size_override("font_size", 88)
	gps_power_lbl.add_theme_color_override("font_color", Color(0.08, 0.09, 0.11))
	vp.add_child(gps_power_lbl)

	var w_lbl := Label.new()
	w_lbl.text = "WATTS"
	w_lbl.position = Vector2(0, 346)
	w_lbl.size = Vector2(256, 30)
	w_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	w_lbl.add_theme_font_size_override("font_size", 22)
	w_lbl.add_theme_color_override("font_color", Color(0.28, 0.30, 0.33))
	vp.add_child(w_lbl)

	var scr := MeshInstance3D.new()
	var scr_m := PlaneMesh.new()
	scr_m.size = Vector2(0.048, 0.084)
	var scr_mat := StandardMaterial3D.new()
	scr_mat.albedo_texture = vp.get_texture()
	scr_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	scr_m.material = scr_mat
	scr.mesh = scr_m
	scr.position = Vector3(0.0, 0.0066, 0.0)
	unit.add_child(scr)

	# Spinning front wheel with tan sidewall, deep carbon rim & spokes
	wheel_node = Node3D.new()
	wheel_node.position = Vector3(0.0, -0.66, -0.12)
	rig.add_child(wheel_node)

	var tyre := MeshInstance3D.new()
	var tyre_m := TorusMesh.new()
	tyre_m.inner_radius = 0.320
	tyre_m.outer_radius = 0.346
	tyre_m.material = tape
	tyre.mesh = tyre_m
	tyre.rotation_degrees = Vector3(0.0, 0.0, 90.0)
	wheel_node.add_child(tyre)

	var sw := MeshInstance3D.new()
	var sw_m := TorusMesh.new()
	sw_m.inner_radius = 0.308
	sw_m.outer_radius = 0.326
	sw_m.material = tan_wall
	sw.mesh = sw_m
	sw.rotation_degrees = Vector3(0.0, 0.0, 90.0)
	wheel_node.add_child(sw)

	var rim := MeshInstance3D.new()
	var rim_m := TorusMesh.new()
	rim_m.inner_radius = 0.282
	rim_m.outer_radius = 0.312
	rim_m.material = carbon
	rim.mesh = rim_m
	rim.rotation_degrees = Vector3(0.0, 0.0, 90.0)
	wheel_node.add_child(rim)

	var spoke_m := CylinderMesh.new()
	spoke_m.top_radius = 0.0012
	spoke_m.bottom_radius = 0.0012
	spoke_m.height = 0.58
	spoke_m.radial_segments = 4
	spoke_m.material = alloy
	for k in 8:
		var sp := MeshInstance3D.new()
		sp.mesh = spoke_m
		sp.rotation.x = (float(k) / 8.0) * PI
		wheel_node.add_child(sp)

func _sample_road(s: float) -> Dictionary:
	var f := (fposmod(s, road_length) / road_length) * float(sample_count)
	var i := int(floorf(f)) % sample_count
	var j := (i + 1) % sample_count
	var k := f - floorf(f)
	var p := road_points[i].lerp(road_points[j], k)
	var t := road_tangents[i].lerp(road_tangents[j], k).normalized()
	var r := Vector3(-t.z, 0.0, t.x).normalized()
	return {"p": p, "t": t, "r": r}

func _process(delta: float) -> void:
	var dt := minf(delta, 0.05)
	power_w += (target_power_w - power_w) * minf(1.0, dt * 3.0)

	var pose := _sample_road(dist_s)
	var slope: float = pose["t"].y if pose["t"].y > 0.0 else pose["t"].y * 0.5
	var brake := RIDER_MASS * 0.5 * (speed_ms - 15.0) if speed_ms > 15.0 else 0.0
	var force := power_w / maxf(speed_ms, 2.0) - RIDER_MASS * GRAVITY * (slope + CRR) - 0.5 * RHO * CDA * speed_ms * speed_ms - brake
	speed_ms = maxf(0.5, speed_ms + (force / RIDER_MASS) * dt)

	dist_s = fposmod(dist_s + speed_ms * dt, road_length)
	total_dist += speed_ms * dt
	grade_pct += (pose["t"].y * 100.0 - grade_pct) * minf(1.0, dt * 2.0)

	pose = _sample_road(dist_s)
	var ahead := _sample_road(dist_s + 9.0)
	var probe := _sample_road(dist_s + 4.0)
	var kappa: float = -(pose["t"].z * probe["t"].x - pose["t"].x * probe["t"].z) / 4.0
	lean_rad += (atan(speed_ms * speed_ms * kappa / GRAVITY) * 0.55 - lean_rad) * minf(1.0, dt * 3.0)

	var cadence := (60.0 + minf(40.0, power_w / 8.0)) if power_w > 5.0 else 0.0
	pedal_phase += dt * TAU * cadence / 60.0
	var sway := sin(pedal_phase) * 0.004 * minf(1.0, power_w / 300.0)

	var cam_pos: Vector3 = pose["p"] + pose["r"] * (LANE_OFFSET + sway) + Vector3(0.0, 1.52, 0.0)
	var look_pos: Vector3 = ahead["p"] + ahead["r"] * LANE_OFFSET + Vector3(0.0, 0.35, 0.0)
	camera.global_position = cam_pos
	camera.look_at(look_pos, Vector3.UP)
	camera.rotate_object_local(Vector3.FORWARD, lean_rad)
	camera.fov = 62.0 + minf(speed_ms, 20.0) * 0.75

	if wheel_node:
		wheel_node.rotate_x(-(speed_ms / 0.335) * dt)

	if audio_synth:
		audio_synth.set_ride_params(speed_ms, rain_amount)

	var kmh := speed_ms * 3.6
	hud_power.text = "%d" % roundi(power_w)
	hud_speed.text = "%.1f" % kmh
	hud_grade.text = "%+.1f" % grade_pct
	hud_dist.text = "%.2f" % (total_dist / 1000.0)

	if gps_speed_lbl:
		gps_speed_lbl.text = "%d" % roundi(kmh)
		gps_power_lbl.text = "%d" % roundi(power_w)
		gps_grade_lbl.text = "GPS   %+.1f%%" % grade_pct
