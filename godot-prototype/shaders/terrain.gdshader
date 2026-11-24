shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D grass_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;

varying vec3 world_pos;
varying vec3 world_nrm;

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

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	world_nrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 uv_near = world_pos.xz * 0.22;
	vec2 uv_far = world_pos.xz * 0.031;

	vec3 g1 = texture(grass_albedo, uv_near).rgb;
	vec3 g2 = texture(grass_albedo, uv_far).rgb;
	vec3 grass_col = mix(g1, g2, 0.28);

	// Warm dry/lush meadow colour variation across hillsides
	float patch_n = vnoise(world_pos.xz * 0.018);
	vec3 tint = mix(vec3(0.76, 0.94, 0.64), vec3(1.24, 1.06, 0.68), smoothstep(0.25, 0.75, patch_n));
	grass_col *= tint;

	// Multi-scale rock face texture to prevent repetition on cliffs
	vec3 r1 = texture(rock_albedo, world_pos.xz * 0.08).rgb;
	vec3 r2 = texture(rock_albedo, world_pos.xz * 0.015).rgb;
	vec3 rock_col = mix(r1, r2, 0.45) * (0.65 + dot(r2, vec3(0.333)) * 0.9);

	float slope = 1.0 - clamp(world_nrm.y, 0.0, 1.0);
	float rock_mask = smoothstep(0.18, 0.42, slope + (vnoise(world_pos.xz * 0.04) - 0.5) * 0.16);
	float snow_mask = smoothstep(235.0, 315.0, world_pos.y + (vnoise(world_pos.xz * 0.02) - 0.5) * 45.0) * smoothstep(0.55, 0.28, slope);

	vec3 col = mix(grass_col, rock_col, rock_mask);
	col = mix(col, vec3(0.92, 0.94, 0.97), snow_mask);

	ALBEDO = col;
	ROUGHNESS = mix(mix(0.94, 0.86, rock_mask), 0.72, snow_mask);
	SPECULAR = mix(0.25, 0.45, snow_mask);
	NORMAL_MAP = texture(grass_normal, uv_near).rgb;
	NORMAL_MAP_DEPTH = mix(0.8, 0.25, rock_mask);
}
