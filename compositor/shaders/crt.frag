#version 100
/* ──────────────────────────────────────────────────────────────
 * sentinel-os/compositor/shaders/crt.frag
 * CRT scanline overlay shader for Sentinel-WM
 * Renders scanlines + vignette + phosphor glow
 * ────────────────────────────────────────────────────────────── */

precision mediump float;

varying vec2 v_texcoord;
uniform sampler2D u_texture;
uniform float u_time;

void main() {
    vec4 color = texture2D(u_texture, v_texcoord);

    /* Scanlines — every 3rd pixel row is darkened */
    float scanline = sin(v_texcoord.y * 800.0 * 3.14159) * 0.5 + 0.5;
    scanline = pow(scanline, 2.0);
    color.rgb *= mix(1.0, 0.88, scanline * 0.5);

    /* Vignette — darkened corners */
    vec2 uv = v_texcoord * 2.0 - 1.0;
    float vig = 1.0 - dot(uv, uv) * 0.3;
    color.rgb *= clamp(vig, 0.0, 1.0);

    /* Phosphor glow — subtle green/cyan tint */
    color.r *= 0.95;
    color.g *= 1.02;
    color.b *= 1.05;

    /* Subtle flicker */
    float flicker = 1.0 - 0.008 * sin(u_time * 60.0);
    color.rgb *= flicker;

    gl_FragColor = color;
}
