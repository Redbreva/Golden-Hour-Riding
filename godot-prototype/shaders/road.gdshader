shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D asphalt_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D asphalt_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float wetness : hint_range(0.0, 1.0) = 0.25;

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

void fragment() {
	vec2 road_uv = vec2(UV.x * 2.2, UV.y * 0.28);
	vec3 col = texture(asphalt_albedo, road_uv).rgb * 0.72;

	// Subtle wheel-track darkening
	float track = exp(-pow((UV.x - 0.26) * 9.0, 2.0)) + exp(-pow((UV.x - 0.74) * 9.0, 2.0));
	col *= (1.0 - track * 0.16);

	// Painted white edge lines & dashed centre line
	float wear = smoothstep(0.22, 0.65, vnoise(vec2(UV.x * 48.0, UV.y * 8.0)));
	float edge_l = smoothstep(0.032, 0.036, UV.x) * (1.0 - smoothstep(0.052, 0.056, UV.x));
	float edge_r = smoothstep(0.944, 0.948, UV.x) * (1.0 - smoothstep(0.964, 0.968, UV.x));
	float dash = step(0.42, fract(UV.y * 0.085));
	float centre = smoothstep(0.492, 0.495, UV.x) * (1.0 - smoothstep(0.505, 0.508, UV.x)) * dash;
	float paint = clamp((edge_l + edge_r + centre) * (0.72 + 0.28 * wear), 0.0, 1.0);
	col = mix(col, vec3(0.88, 0.86, 0.80), paint * 0.9);

	// Dampness & subtle puddles in ruts (realistic satin wet tarmac, no mirror glare)
	float puddle = smoothstep(0.58, 0.85, vnoise(vec2(UV.x * 4.0, UV.y * 0.18))) * (0.25 + wetness * 0.55);
	col *= mix(1.0, 0.68, puddle * 0.45 + wetness * 0.28);

	ALBEDO = col;
	ROUGHNESS = mix(0.86, 0.38, clamp(puddle + wetness * 0.45, 0.0, 0.85));
	SPECULAR = mix(0.28, 0.44, clamp(puddle + wetness * 0.35, 0.0, 1.0));
	NORMAL_MAP = texture(asphalt_normal, road_uv).rgb;
	NORMAL_MAP_DEPTH = mix(1.1, 0.45, puddle);
}
