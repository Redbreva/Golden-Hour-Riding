shader_type spatial;
render_mode blend_mix, depth_draw_never, cull_disabled, unshaded;

uniform vec3 sun_dir = vec3(-0.4, 0.16, -0.9);
uniform vec3 lit_color : source_color = vec3(1.0, 0.78, 0.54);
uniform vec3 dark_color : source_color = vec3(0.32, 0.35, 0.46);
uniform float coverage : hint_range(0.0, 1.0) = 0.58;
uniform float opacity : hint_range(0.0, 1.0) = 0.85;

varying vec3 world_pos;

float hash2(vec2 p) {
	return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x),
		mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x),
		f.y
	);
}

float fbm(vec2 p) {
	float s = 0.0;
	float a = 0.5;
	for (int i = 0; i < 6; i++) {
		s += a * vnoise(p);
		p = p * 2.04 + vec2(7.1, 3.7);
		a *= 0.5;
	}
	return s;
}

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 p = world_pos.xz * 0.00032 + vec2(TIME * 0.0035, TIME * 0.0018);
	float d = smoothstep(1.0 - coverage, 0.86, fbm(p));
	float d_sun = smoothstep(1.0 - coverage, 0.86, fbm(p + normalize(sun_dir.xz) * 0.065));
	float rim = clamp(0.5 + (d - d_sun) * 1.9, 0.0, 1.0);
	vec3 col = mix(dark_color, lit_color, rim);

	float dist = length(world_pos.xz - CAMERA_POSITION_WORLD.xz);
	float horizon_fade = 1.0 - smoothstep(2600.0, 7200.0, dist);

	ALBEDO = col;
	ALPHA = d * horizon_fade * opacity;
}
