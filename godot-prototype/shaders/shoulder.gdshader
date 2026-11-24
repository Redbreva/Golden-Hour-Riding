shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D gravel_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;

void fragment() {
	vec2 uv_g = vec2(UV.x * 1.5, UV.y * 0.45);
	vec3 gravel = texture(gravel_albedo, uv_g).rgb * 0.68;
	vec3 grass = texture(grass_albedo, uv_g * 0.7).rgb * vec3(0.82, 0.96, 0.68);
	float blend = smoothstep(0.08, 0.72, UV.x);
	ALBEDO = mix(gravel, grass, blend);
	ROUGHNESS = 0.96;
	SPECULAR = 0.18;
}
