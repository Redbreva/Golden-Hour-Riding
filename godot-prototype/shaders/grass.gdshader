shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled, diffuse_burley, specular_schlick_ggx;

uniform sampler2D grass_tex : source_color, filter_linear_mipmap_anisotropic;
uniform float wind_strength : hint_range(0.0, 1.0) = 0.18;

varying float v_tip;

void vertex() {
	v_tip = clamp(1.0 - UV.y, 0.0, 1.0);
	vec3 wp = (MODEL_MATRIX * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
	float sway = sin(TIME * 1.8 + wp.x * 0.37 + wp.z * 0.29) * wind_strength
		+ sin(TIME * 3.6 + wp.x * 1.1) * (wind_strength * 0.35);
	VERTEX.x += sway * v_tip * v_tip;
	VERTEX.z += sway * 0.55 * v_tip * v_tip;
	NORMAL = vec3(0.0, 1.0, 0.0);
}

void fragment() {
	vec4 tex = texture(grass_tex, UV);
	if (tex.a < 0.45) {
		discard;
	}
	ALBEDO = tex.rgb * COLOR.rgb;
	ROUGHNESS = 0.90;
	SPECULAR = 0.22;
	BACKLIGHT = vec3(0.42, 0.34, 0.12) * v_tip;
}
