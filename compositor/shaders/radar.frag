#version 100
/* ──────────────────────────────────────────────────────────────
 * sentinel-os/compositor/shaders/radar.frag
 * Radar sweep animation shader for tactical map overlay
 * ────────────────────────────────────────────────────────────── */

precision mediump float;

varying vec2 v_texcoord;
uniform float u_time;
uniform vec2 u_center;     /* radar center in UV coords */
uniform vec3 u_color;      /* sweep color (default: cyan) */

void main() {
    vec2 uv = v_texcoord - u_center;
    float dist = length(uv);
    float angle = atan(uv.y, uv.x);

    /* Sweep beam — rotates at ~6 RPM */
    float sweep_angle = mod(u_time * 0.628, 6.28318); /* 2*PI / 10s */
    float delta = mod(angle - sweep_angle + 6.28318, 6.28318);

    /* Fade trail behind sweep */
    float trail = smoothstep(0.0, 1.2, delta) * (1.0 - smoothstep(1.2, 1.5, delta));
    trail *= (1.0 - dist * 0.8);

    /* Range rings */
    float ring1 = smoothstep(0.002, 0.0, abs(dist - 0.2));
    float ring2 = smoothstep(0.002, 0.0, abs(dist - 0.4));
    float ring3 = smoothstep(0.002, 0.0, abs(dist - 0.6));

    /* Combine */
    vec3 color = u_color * trail * 0.3;
    color += u_color * (ring1 + ring2 + ring3) * 0.15;
    color *= (1.0 - dist * 0.5);

    gl_FragColor = vec4(color, trail * 0.5 + (ring1 + ring2 + ring3) * 0.1);
}
