// GPU renderer (WebGL2). All textures are stored top row first; premultiplied alpha everywhere.

const VS_FULL = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos*0.5+0.5; gl_Position = vec4(a_pos,0.,1.); }`;

const VS_QUAD = `#version 300 es
in vec2 a_pos; uniform mat3 u_m; out vec2 v_uv; out vec2 v_dst;
void main(){ vec2 uv = a_pos*0.5+0.5; v_uv = uv; vec3 p = u_m*vec3(uv,1.); gl_Position = vec4(p.xy,0.,1.); v_dst = p.xy*0.5+0.5; }`;

const HEAD = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 o;
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
`;

const FS_COPY = HEAD + `uniform sampler2D u_tex; uniform float u_flip; uniform float u_alpha;
void main(){ vec2 uv = v_uv; if(u_flip>0.5) uv.y = 1.-uv.y; o = texture(u_tex, uv)*u_alpha; }`;

const FS_SOLID = HEAD + `uniform vec4 u_c; void main(){ o = u_c; }`;

// 2x downsample: averages a 4x4 block (four bilinear taps) — a true average, nothing of the original survives
const FS_DOWN = HEAD + `uniform sampler2D u_tex; uniform vec2 u_px;
void main(){ vec2 d = u_px*0.5;
  o = 0.25*(texture(u_tex,v_uv+vec2(-d.x,-d.y))+texture(u_tex,v_uv+vec2(d.x,-d.y))+texture(u_tex,v_uv+vec2(-d.x,d.y))+texture(u_tex,v_uv+vec2(d.x,d.y))); }`;

// separable gaussian (9 taps folded into 5 bilinear reads)
const FS_GAUSS = HEAD + `uniform sampler2D u_tex; uniform vec2 u_dir;
void main(){
  vec4 c = texture(u_tex,v_uv)*0.2270270270;
  c += texture(u_tex,v_uv+u_dir*1.3846153846)*0.3162162162; c += texture(u_tex,v_uv-u_dir*1.3846153846)*0.3162162162;
  c += texture(u_tex,v_uv+u_dir*3.2307692308)*0.0702702703; c += texture(u_tex,v_uv-u_dir*3.2307692308)*0.0702702703;
  o = c; }`;

/* Colour: chroma key, cut-out mask, adjustments, filter look */
const FS_COLOR = HEAD + `uniform sampler2D u_tex; uniform sampler2D u_mask; uniform vec2 u_res; uniform float u_t;
uniform float u_adj[14]; // exposure brightness contrast saturation vibrance temp tint hue highlights shadows fade sharpen vignette grain
uniform vec3 u_sh; uniform vec3 u_hi; uniform float u_tone; uniform float u_mono;
uniform vec4 u_key; uniform vec3 u_keyc; uniform float u_useMask; uniform float u_maskInv;
vec3 rgb2ycc(vec3 c){ return vec3(luma(c), (c.b-luma(c))*0.565, (c.r-luma(c))*0.713); }
vec3 softl(vec3 a, vec3 b){ return mix(2.*a*b + a*a*(1.-2.*b), sqrt(a)*(2.*b-1.)+2.*a*(1.-b), step(0.5,b)); }
void main(){
  vec4 s = texture(u_tex, v_uv);
  float a = s.a; vec3 c = a>0.0001 ? s.rgb/a : vec3(0.);
  if (u_adj[11] > 0.001) { vec2 px = 1./u_res;
    vec3 n = (texture(u_tex,v_uv+vec2(px.x,0)).rgb+texture(u_tex,v_uv-vec2(px.x,0)).rgb+texture(u_tex,v_uv+vec2(0,px.y)).rgb+texture(u_tex,v_uv-vec2(0,px.y)).rgb)*0.25;
    c = c + (c - n/max(a,0.0001)) * u_adj[11]*2.5; }
  // chroma key
  if (u_key.x > 0.5) {
    vec3 k = rgb2ycc(u_keyc), p = rgb2ycc(c);
    float d = distance(p.yz, k.yz);
    float lo = u_key.y*0.25, hi = lo + 0.005 + u_key.z*0.2;
    float m = smoothstep(lo, hi, d);
    a *= m;
    float spill = (1.-smoothstep(lo, hi*1.6, d))*u_key.w; c = mix(c, vec3(luma(c)), spill);
  }
  if (u_useMask > 0.5) { float m = texture(u_mask, v_uv).r; if (u_maskInv>0.5) m = 1.-m; a *= smoothstep(0.25, 0.75, m); }
  c *= pow(2., u_adj[0]*1.5);
  c += u_adj[1]*0.25;
  c = (c-0.5)*(1.+u_adj[2])+0.5;
  float l = luma(clamp(c,0.,1.));
  c += u_adj[9]*0.4*(1.-smoothstep(0.,0.55,l))*(1.-l);
  c += u_adj[8]*0.35*smoothstep(0.45,1.,l);
  c.r += u_adj[5]*0.12; c.b -= u_adj[5]*0.12; c.g -= u_adj[6]*0.1; c.rb += u_adj[6]*0.04;
  if (abs(u_adj[7])>0.001) { float h = u_adj[7]*3.14159;
    vec3 yiq = mat3(0.299,0.596,0.211, 0.587,-0.274,-0.523, 0.114,-0.322,0.312)*c;
    float ch = cos(h), sh = sin(h); yiq.yz = vec2(yiq.y*ch - yiq.z*sh, yiq.y*sh + yiq.z*ch);
    c = mat3(1.,1.,1., 0.956,-0.272,-1.106, 0.621,-0.647,1.703)*yiq; }
  l = luma(c);
  c = mix(vec3(l), c, 1.+u_adj[3]);
  float sat = max(c.r,max(c.g,c.b)) - min(c.r,min(c.g,c.b));
  c = mix(vec3(l), c, 1.+u_adj[4]*(1.-sat));
  c = mix(c, vec3(luma(c)), u_mono);
  if (u_tone > 0.001) { vec3 tn = mix(u_sh, u_hi, smoothstep(0.,1.,luma(clamp(c,0.,1.)))); c = mix(c, softl(clamp(c,0.,1.), tn), u_tone); }
  c = mix(vec3(u_adj[10]*0.22), vec3(1.-u_adj[10]*0.06), clamp(c,0.,1.));
  if (abs(u_adj[12])>0.001) { vec2 q = v_uv-0.5; q.x *= u_res.x/u_res.y; float d = length(q)/length(vec2(0.5*u_res.x/u_res.y,0.5));
    float v = smoothstep(0.35, 1.05, d); c = u_adj[12]>0. ? c*(1.-u_adj[12]*v*0.9) : mix(c, vec3(1.), -u_adj[12]*v*0.7); }
  if (u_adj[13] > 0.001) { float g = hash(v_uv*u_res + fract(u_t*7.13)*100.) - 0.5; c += g*u_adj[13]*0.22; }
  o = vec4(clamp(c,0.,1.)*a, a);
}`;

/* Effects (one shader, chosen by number) */
const FS_FX = HEAD + `uniform sampler2D u_tex; uniform sampler2D u_blur; uniform vec2 u_res; uniform float u_t; uniform float u_a; uniform float u_b; uniform int u_type; uniform float u_seed;
vec4 tx(vec2 uv){ return texture(u_tex, clamp(uv,0.,1.)); }
vec4 txm(vec2 uv){ uv = abs(mod(uv+1.,2.)-1.); return texture(u_tex, uv); }
void main(){
  vec2 uv = v_uv; vec4 c = tx(uv); float t = u_t; float A = u_a; vec2 px = 1./u_res; float asp = u_res.x/u_res.y;
  if (u_type==1) { o = mix(c, texture(u_blur, uv), clamp(A*1.5,0.,1.)); return; }
  if (u_type==2) { float n = mix(160., 12., A); vec2 b = vec2(n*asp, n); vec2 q = (floor(uv*b)+0.5)/b; o = tx(q); return; }
  if (u_type==3) { float d = A*0.025; o = vec4(tx(uv+vec2(d,0)).r, c.g, tx(uv-vec2(d,0)).b, c.a); return; }
  if (u_type==4) { float tt = floor(t*12.*max(u_b,0.2)); float band = floor(uv.y*mix(8.,40.,hash(vec2(tt,1.))));
    float h = hash(vec2(band, tt)); float on = step(1.-A*0.5, h);
    vec2 q = uv + vec2((hash(vec2(band,tt+3.))-0.5)*0.2*A*on, 0.);
    float d = A*0.02*(0.5+on); o = vec4(tx(q+vec2(d,0)).r, tx(q).g, tx(q-vec2(d,0)).b, c.a);
    if (hash(vec2(tt,band*3.)) > 1.-A*0.08) o.rgb = vec3(hash(uv*u_res+tt)); return; }
  if (u_type==5) { float w = sin(uv.y*6.+t*2.)*0.002*A + (hash(vec2(floor(uv.y*240.), floor(t*30.)))-0.5)*0.004*A;
    vec2 q = uv+vec2(w,0); vec3 col = vec3(tx(q+vec2(0.004*A,0)).r, tx(q).g, tx(q-vec2(0.004*A,0)).b);
    col *= 0.9 + 0.1*sin(uv.y*u_res.y*1.2);
    col = mix(col, vec3(luma(col)), 0.25*A); col += (hash(uv*u_res+t)-0.5)*0.12*A;
    float bar = smoothstep(0.0,0.02, abs(fract(uv.y - t*0.15)-0.5)); col = mix(col*1.15, col, bar);
    o = vec4(col*c.a, c.a); return; }
  if (u_type==6) { float g = hash(uv*u_res+fract(t*9.1)*91.)-0.5; o = vec4(c.rgb + g*A*0.3*c.a, c.a); return; }
  if (u_type==7) { vec3 col = vec3(luma(c.rgb)); col *= vec3(1.07,0.95,0.78);
    col *= 0.92 + 0.08*hash(vec2(floor(t*18.),2.));
    float sx = hash(vec2(floor(t*12.),7.)); float scr = 1.-smoothstep(0.,0.0015,abs(uv.x-sx))*step(0.5,hash(vec2(floor(t*12.),9.)))*0.6;
    col *= scr; col += (hash(uv*u_res+t)-0.5)*0.1;
    vec2 q=uv-0.5; col *= 1.-dot(q,q)*1.4;
    o = vec4(mix(c.rgb, col*c.a, A), c.a); return; }
  if (u_type==8) { vec2 q = uv-0.5; q.x*=asp; float d = length(q)/length(vec2(0.5*asp,0.5)); o = vec4(c.rgb*(1.-A*smoothstep(0.3,1.0,d)), c.a); return; }
  if (u_type==9) { vec4 n = (tx(uv+vec2(px.x,0))+tx(uv-vec2(px.x,0))+tx(uv+vec2(0,px.y))+tx(uv-vec2(0,px.y)))*0.25; o = clamp(c+(c-n)*A*3.,0.,1.); return; }
  if (u_type==10) { o = tx(vec2(uv.x<0.5?uv.x:1.-uv.x, uv.y)); return; }
  if (u_type==11) { o = tx(vec2(uv.x, uv.y<0.5?uv.y:1.-uv.y)); return; }
  if (u_type==12) { vec2 q = vec2(uv.x<0.5?uv.x:1.-uv.x, uv.y<0.5?uv.y:1.-uv.y); o = tx(q); return; }
  if (u_type==13) { o = tx(fract(uv*2.)); return; }
  if (u_type==14) { o = tx(vec2(uv.x, fract(uv.y*3.)*0.6+0.2)); return; }
  if (u_type==46) { o = tx(fract(uv*3.)); return; }
  if (u_type==15) { o = vec4(mix(c.rgb, c.a-c.rgb, A), c.a); return; }
  if (u_type==16) { o = vec4(mix(c.rgb, vec3(luma(c.rgb)), A), c.a); return; }
  if (u_type==17) { float n = mix(12.,3.,A); o = vec4(floor(c.rgb*n+0.5)/n, c.a); return; }
  if (u_type==18) { float gx = luma(tx(uv+vec2(px.x,0)).rgb)-luma(tx(uv-vec2(px.x,0)).rgb), gy = luma(tx(uv+vec2(0,px.y)).rgb)-luma(tx(uv-vec2(0,px.y)).rgb);
    float e = 1.-clamp(length(vec2(gx,gy))*4.,0.,1.); o = vec4(mix(c.rgb, vec3(e)*c.a, A), c.a); return; }
  if (u_type==44) { float e = luma(tx(uv-px).rgb) - luma(tx(uv+px).rgb); o = vec4(mix(c.rgb, vec3(0.5+e*2.)*c.a, A), c.a); return; }
  if (u_type==19) { vec2 q = (uv-0.5)*2.; q.x*=asp; float r = length(q); vec2 d = q*(1.+A*0.6*r*r)/(1.+A*0.6); d.x/=asp; o = tx(d*0.5+0.5); return; }
  if (u_type==20) { vec2 q = uv + vec2(sin(uv.y*18.+t*4.*u_b)*0.012, cos(uv.x*14.+t*3.*u_b)*0.012)*A; o = txm(q); return; }
  if (u_type==21) { float s = t*14.*u_b; vec2 d = (vec2(noise(vec2(s,1.)), noise(vec2(s,9.)))-0.5)*0.06*A; float z = 1.-0.04*A; o = tx((uv-0.5)*z+0.5+d); return; }
  if (u_type==22) { float z = 1.-A*0.12*(0.5+0.5*sin(t*6.2832*u_b*1.2)); o = tx((uv-0.5)*z+0.5); return; }
  if (u_type==23) { float f = pow(max(0.,sin(t*6.2832*u_b*0.8)),8.)*A; o = vec4(mix(c.rgb, vec3(c.a), f), c.a); return; }
  if (u_type==38) { float f = step(0.5, fract(t*8.*u_b))*A; o = vec4(mix(c.rgb, vec3(c.a), f*0.8), c.a); return; }
  if (u_type==24) { vec4 b = texture(u_blur, uv); o = clamp(c + b*A*1.2*smoothstep(0.35,1.,luma(b.rgb)), 0., 1.); return; }
  if (u_type==25) { vec4 b = texture(u_blur, uv); vec3 col = 1.-(1.-c.rgb)*(1.-b.rgb*0.9); o = vec4(mix(c.rgb, mix(col, b.rgb, 0.3), A), c.a); return; }
  if (u_type==26) { vec2 q = uv; float m = t*0.25*u_b;
    vec3 l1 = vec3(1.,0.55,0.2)*smoothstep(0.9,0.,distance(q, vec2(0.15+0.3*sin(m),0.2+0.2*cos(m*1.3))));
    vec3 l2 = vec3(1.,0.25,0.3)*smoothstep(0.8,0.,distance(q, vec2(0.9-0.2*cos(m*0.7),0.85+0.15*sin(m))));
    vec3 lk = (l1+l2)*A*0.9; o = vec4(1.-(1.-c.rgb)*(1.-lk*c.a), c.a); return; }
  if (u_type==27) { float h = A*0.14; float in_ = step(h, uv.y)*step(uv.y, 1.-h); o = vec4(c.rgb*in_, mix(1., c.a, in_)); if(in_<0.5) o = vec4(0,0,0,1); return; }
  if (u_type==28) { float l = 0.5+0.5*sin(uv.y*u_res.y*1.6); o = vec4(c.rgb*(1.-A*0.45*l), c.a); return; }
  if (u_type==29) { vec2 q = uv-0.5; float d = A*0.03*length(q); o = vec4(tx(uv+q*d*2.).r, c.g, tx(uv-q*d*2.).b, c.a); return; }
  if (u_type==30) { float s = mix(120., 40., A); vec2 g = uv*vec2(s*asp, s); vec2 cell = fract(g)-0.5; vec4 cc = tx((floor(g)+0.5)/vec2(s*asp,s));
    float r = sqrt(1.-luma(cc.rgb))*0.6; float dot_ = 1.-smoothstep(r-0.06, r+0.06, length(cell)); o = vec4(vec3(1.-dot_)*mix(vec3(1),cc.rgb,0.3)*c.a, c.a); return; }
  if (u_type==31) { vec2 q = uv*vec2(asp,1.)*vec2(60.,6.); q.y += t*u_b*6.; q.x += q.y*0.08; vec2 id = floor(q); float h = hash(id);
    float drop = step(0.92-A*0.12, h)*smoothstep(0.0,0.25,fract(q.y)+h*0.3)*(1.-smoothstep(0.25,0.9,fract(q.y)))*smoothstep(0.5,0.1,abs(fract(q.x)-0.5));
    vec3 col = c.rgb*(1.-A*0.15) + vec3(0.75,0.82,0.9)*drop*0.6*c.a; o = vec4(col, c.a); return; }
  if (u_type==32) { vec3 col = c.rgb; for (int i=0;i<3;i++){ float fi=float(i); vec2 q = uv*vec2(asp,1.)*(10.+fi*7.); q.y -= t*u_b*(0.6+fi*0.3)*(1.+fi); q.x += sin(q.y*0.7+t+fi)*0.3; vec2 id = floor(q); vec2 f = fract(q)-0.5;
      float h = hash(id+fi*7.); float flake = step(1.-A*0.35, h)*(1.-smoothstep(0.03,0.1+0.05*fi, length(f-vec2(hash(id+3.)-0.5,0.)*0.6))); col += vec3(flake)*0.9*c.a; }
    o = vec4(min(col,vec3(c.a)), c.a); return; }
  if (u_type==33) { vec3 col = c.rgb; vec2 q = uv*vec2(asp,1.)*28.; q += vec2(t*0.3*u_b, -t*0.2*u_b); vec2 id=floor(q); vec2 f=fract(q)-0.5;
    float h = hash(id); float p = step(1.-A*0.12,h)*(1.-smoothstep(0.02,0.06,length(f-(vec2(hash(id+1.),hash(id+2.))-0.5)*0.7)));
    col += vec3(1.,0.95,0.85)*p*0.5*(0.5+0.5*sin(t*3.+h*20.))*c.a; o = vec4(min(col,vec3(c.a)),c.a); return; }
  if (u_type==45) { float f = noise(uv*vec2(asp,1.)*3.+vec2(t*0.08*u_b,0.)) * 0.6 + noise(uv*vec2(asp,1.)*7.-vec2(t*0.12*u_b,0.))*0.4;
    float k = A*smoothstep(0.2,0.9,f)*0.85; o = vec4(mix(c.rgb, vec3(0.86,0.88,0.9)*c.a, k), c.a); return; }
  if (u_type==34) { vec4 b = texture(u_blur, uv); float band = mix(0.05,0.3,u_b); float m = smoothstep(band, band+0.2, abs(uv.y-0.5)); vec4 r = mix(c, b, m*A*1.4);
    r.rgb = mix(vec3(luma(r.rgb)), r.rgb, 1.+0.25*A); o = clamp(r,0.,1.); return; }
  if (u_type==35) { vec2 q = (uv-0.5)*vec2(asp,1.); float r = length(q); float ang = A*4.*smoothstep(0.6,0.,r); float cs=cos(ang), sn=sin(ang);
    q = vec2(q.x*cs-q.y*sn, q.x*sn+q.y*cs); o = tx(q/vec2(asp,1.)+0.5); return; }
  if (u_type==36) { float n = hash(floor(uv*u_res*0.5)+floor(t*24.)); o = vec4(mix(c.rgb, vec3(n)*c.a, A*0.6), c.a); return; }
  if (u_type==37) { o = vec4(c.rgb*(1.-A), c.a); return; }
  if (u_type==39) { vec4 s = vec4(0.); vec2 d = uv-0.5; for (int i=0;i<16;i++){ float k = 1.-float(i)*A*0.012; s += tx(d*k+0.5);} o = s/16.; return; }
  if (u_type==40) { vec4 s = vec4(0.); for (int i=0;i<16;i++){ s += tx(uv+vec2((float(i)/15.-0.5)*A*0.06,0.)); } o = s/16.; return; }
  if (u_type==41) { float l = luma(c.rgb/max(c.a,0.001)); vec3 col = mix(vec3(0.1,0.05,0.35), vec3(1.,0.75,0.3), l); o = vec4(mix(c.rgb, col*c.a, A), c.a); return; }
  if (u_type==42) { float l = luma(c.rgb); vec3 col = vec3(0.1,1.,0.25)*(l*1.6+0.05); col += (hash(uv*u_res+t)-0.5)*0.15; vec2 q=uv-0.5; col *= 1.-dot(q,q)*2.;
    col *= 0.9+0.1*sin(uv.y*u_res.y); o = vec4(mix(c.rgb, col*c.a, A), c.a); return; }
  if (u_type==43) { float l = luma(c.rgb); vec3 col = l<0.33 ? mix(vec3(0,0,0.4), vec3(0.6,0,0.7), l*3.) : l<0.66 ? mix(vec3(0.6,0,0.7), vec3(1.,0.4,0.), (l-0.33)*3.) : mix(vec3(1.,0.4,0.), vec3(1.,1.,0.5), (l-0.66)*3.);
    o = vec4(mix(c.rgb, col*c.a, A), c.a); return; }
  if (u_type==47) { float b = A*0.08; vec2 d = min(uv, 1.-uv)*vec2(asp,1.); float e = min(d.x,d.y); float m = step(b, e); o = mix(vec4(vec3(0.97),1.), c, m); return; }
  o = c;
}`;

/* Privacy cover: faces and blur areas. Each region is an ellipse or rounded box; the edge can fade out. */
const MAXR = 40;
const FS_COVER = HEAD + `uniform sampler2D u_tex; uniform sampler2D u_blur; uniform vec2 u_res; uniform int u_n;
uniform vec4 u_r[${MAXR}]; uniform vec4 u_rs[${MAXR}]; // u_r: centre x,y, half w,h (px). u_rs: shape, feather, style, angle
uniform vec4 u_col; uniform float u_blocks; uniform float u_t; uniform float u_invert;
float regionA(int i, vec2 p, out float size){
  vec4 r = u_r[i]; vec4 s = u_rs[i]; size = max(r.z, r.w);
  vec2 q = p - r.xy; float ca = cos(s.w), sa = sin(s.w); q = vec2(q.x*ca + q.y*sa, -q.x*sa + q.y*ca);
  float d;
  if (s.x < 0.5) d = length(q / r.zw);
  else { float rad = min(r.z, r.w) * (s.x > 1.5 ? 0.05 : 0.4); vec2 b = abs(q) - r.zw + rad; float sd = length(max(b,0.)) + min(max(b.x,b.y),0.) - rad; d = 1. + sd / min(r.z, r.w); }
  float f = max(s.y, 0.015);
  return 1. - smoothstep(1., 1. + f, d);
}
void main(){
  vec2 p = v_uv*u_res; vec4 c = texture(u_tex, v_uv);
  float a = 0.; float size = 1.; int style = 0;
  for (int i=0;i<${MAXR};i++){ if (i>=u_n) break; float sz; float ai = regionA(i, p, sz); if (ai > a) { a = ai; size = sz; style = int(u_rs[i].z); } }
  if (u_invert > 0.5) a = 1. - a;
  if (a <= 0.) { o = c; return; }
  vec4 cov;
  if (style == 1) { float bs = max(4., size*2./u_blocks); vec2 q = (floor(p/bs)+0.5)*bs; cov = texture(u_blur, q/u_res); }
  else if (style == 2) { cov = vec4(u_col.rgb, 1.)*c.a; }
  else if (style == 3) { cov = texture(u_blur, v_uv); cov.rgb = mix(cov.rgb, vec3(cov.a), 0.18) + (hash(p+u_t)-0.5)*0.06*cov.a; }
  else { cov = texture(u_blur, v_uv); }
  o = mix(c, cov, a);
}`;

/* Placing a layer: transform, crop, shape mask, wipe, opacity and blend mode */
const FS_PLACE = `#version 300 es
precision highp float;
in vec2 v_uv; in vec2 v_dst; out vec4 o;
uniform sampler2D u_tex; uniform sampler2D u_dst; uniform vec4 u_crop; uniform float u_op; uniform int u_blend; uniform int u_useDst;
uniform int u_mask; uniform vec4 u_mk; uniform vec4 u_mk2; uniform vec2 u_size; // mask: centre x,y (0..1), half w,h (0..1); mk2: angle, feather, invert, round
uniform vec4 u_wipe; // visible rect in local uv
uniform float u_flipX; uniform float u_flipY;
float maskA(vec2 uv){
  if (u_mask == 0) return 1.;
  vec2 p = (uv - u_mk.xy) * u_size; float ca = cos(u_mk2.x), sa = sin(u_mk2.x); p = vec2(p.x*ca + p.y*sa, -p.x*sa + p.y*ca);
  vec2 hs = u_mk.zw * u_size; float f = max(u_mk2.y * min(u_size.x,u_size.y) * 0.25, 0.75); float sd;
  if (u_mask == 1) sd = p.y;
  else if (u_mask == 2) sd = abs(p.y) - hs.y;
  else if (u_mask == 3) { float k = length(p/hs); sd = (k-1.)*min(hs.x,hs.y); }
  else if (u_mask == 4) { float rad = min(hs.x,hs.y)*u_mk2.w; vec2 b = abs(p)-hs+rad; sd = length(max(b,0.))+min(max(b.x,b.y),0.)-rad; }
  else if (u_mask == 5) { vec2 q = p/hs; q.y = -q.y*1.15 + 0.12; const float k = 1.7320508; q.x = abs(q.x) - 1.0; q.y = q.y + 1.0/k;
    if (q.x + k*q.y > 0.0) q = vec2(q.x - k*q.y, -k*q.x - q.y)/2.0; q.x -= clamp(q.x, -2.0, 0.0); sd = -length(q)*sign(q.y)*min(hs.x,hs.y); }
  else { vec2 q = abs(p/hs); sd = (q.x + q.y - 1.)*min(hs.x,hs.y)*0.7; }
  float m = 1. - smoothstep(-f, f, sd);
  return u_mk2.z > 0.5 ? 1. - m : m;
}
vec3 bl(vec3 b, vec3 s){
  if (u_blend==1) return b*s; if (u_blend==2) return 1.-(1.-b)*(1.-s);
  if (u_blend==3) return mix(2.*b*s, 1.-2.*(1.-b)*(1.-s), step(0.5,b));
  if (u_blend==4) return min(b,s); if (u_blend==5) return max(b,s); if (u_blend==6) return min(b+s,1.);
  if (u_blend==7) return mix(2.*b*s+b*b*(1.-2.*s), sqrt(b)*(2.*s-1.)+2.*b*(1.-s), step(0.5,s));
  if (u_blend==8) return mix(2.*b*s, 1.-2.*(1.-b)*(1.-s), step(0.5,s));
  if (u_blend==9) return abs(b-s); if (u_blend==10) return min(b/max(1.-s,0.001),1.); if (u_blend==11) return 1.-min((1.-b)/max(s,0.001),1.);
  if (u_blend==12) return b+s-2.*b*s;
  return s;
}
void main(){
  vec2 uv = v_uv;
  if (uv.x < u_wipe.x || uv.y < u_wipe.y || uv.x > u_wipe.z || uv.y > u_wipe.w) discard;
  vec2 su = uv; if (u_flipX>0.5) su.x = 1.-su.x; if (u_flipY>0.5) su.y = 1.-su.y;
  vec4 s = texture(u_tex, u_crop.xy + su*u_crop.zw) * u_op * maskA(uv);
  // soft 1px edge so rotated layers are smooth
  vec2 e = min(uv, 1.-uv) * u_size; s *= clamp(min(e.x,e.y)+0.5, 0., 1.);
  if (u_useDst == 0) { o = s; return; }
  vec4 d = texture(u_dst, v_dst);
  vec3 sc = s.a>0.0001 ? s.rgb/s.a : vec3(0.), dc = d.a>0.0001 ? d.rgb/d.a : vec3(0.);
  vec3 r = mix(sc, bl(dc, sc), d.a);
  o = vec4(r*s.a + d.rgb*(1.-s.a), s.a + d.a*(1.-s.a));
}`;

/* Transitions between two full frames */
const FS_TRANS = HEAD + `uniform sampler2D u_a; uniform sampler2D u_b; uniform float u_p; uniform int u_type; uniform vec2 u_res;
vec4 A(vec2 uv){ return texture(u_a, uv); } vec4 B(vec2 uv){ return texture(u_b, uv); }
vec4 inA(vec2 uv){ return (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) ? vec4(0,0,0,1) : A(uv); }
vec4 inB(vec2 uv){ return (uv.x<0.||uv.y<0.||uv.x>1.||uv.y>1.) ? vec4(0,0,0,1) : B(uv); }
vec4 blurA(vec2 uv, sampler2D t, float r){ vec4 s=vec4(0.); for(int i=0;i<12;i++){ float a=float(i)*2.39996; vec2 d=vec2(cos(a),sin(a))*r*sqrt(float(i)/12.); s+=texture(t,uv+d);} return s/12.; }
void main(){
  vec2 uv = v_uv; float p = u_p; float asp = u_res.x/u_res.y;
  if (u_type==1) { o = mix(A(uv), B(uv), p); return; }
  if (u_type==2) { o = p<0.5 ? mix(A(uv), vec4(0,0,0,1), p*2.) : mix(vec4(0,0,0,1), B(uv), p*2.-1.); return; }
  if (u_type==3) { o = p<0.5 ? mix(A(uv), vec4(1), p*2.) : mix(vec4(1), B(uv), p*2.-1.); return; }
  if (u_type==4) { float r = sin(p*3.14159)*0.04; o = mix(blurA(uv,u_a,r), blurA(uv,u_b,r), smoothstep(0.3,0.7,p)); return; }
  if (u_type==5) { vec4 a = inA((uv-0.5)/(1.+p*1.5)+0.5); vec4 b = inB((uv-0.5)/(0.5+p*0.5)+0.5); o = mix(a, b, smoothstep(0.35,0.75,p)); return; }
  if (u_type==6) { vec4 a = inA((uv-0.5)*(1.+p)+0.5); vec4 b = inB((uv-0.5)*(2.-p)+0.5); o = mix(a, b, smoothstep(0.35,0.75,p)); return; }
  if (u_type==7) { float ang = p*6.2832; vec2 q=(uv-0.5)*vec2(asp,1.); float z = 1.+sin(p*3.14159)*1.2; q*=z; q = mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*q; q/=vec2(asp,1.); q+=0.5;
    o = p<0.5 ? texture(u_a, abs(mod(q+1.,2.)-1.)) : texture(u_b, abs(mod(q+1.,2.)-1.)); return; }
  if (u_type==8) { o = uv.x > 1.-p ? B(uv-vec2(1.-p,0.)) : A(uv); return; }
  if (u_type==9) { o = uv.x < p ? B(uv+vec2(1.-p,0.)) : A(uv); return; }
  if (u_type==10) { o = uv.y > 1.-p ? B(uv-vec2(0.,1.-p)) : A(uv); return; }
  if (u_type==11) { o = uv.y < p ? B(uv+vec2(0.,1.-p)) : A(uv); return; }
  if (u_type==12) { o = uv.x > 1.-p ? B(uv-vec2(1.-p,0.)) : A(uv+vec2(p,0.)); return; }
  if (u_type==13) { o = uv.x < p ? B(uv+vec2(1.-p,0.)) : A(uv-vec2(p,0.)); return; }
  if (u_type==14) { o = uv.y > 1.-p ? B(uv-vec2(0.,1.-p)) : A(uv+vec2(0.,p)); return; }
  if (u_type==15) { o = uv.y < p ? B(uv+vec2(0.,1.-p)) : A(uv-vec2(0.,p)); return; }
  float s = 0.02;
  if (u_type==16) { o = mix(A(uv), B(uv), smoothstep(1.-p-s, 1.-p+s, uv.x*(1.-2.*s)+s)); return; }
  if (u_type==17) { o = mix(A(uv), B(uv), 1.-smoothstep(p-s, p+s, uv.x*(1.-2.*s)+s)); return; }
  if (u_type==18) { o = mix(A(uv), B(uv), smoothstep(1.-p-s, 1.-p+s, uv.y*(1.-2.*s)+s)); return; }
  if (u_type==19) { o = mix(A(uv), B(uv), 1.-smoothstep(p-s, p+s, uv.y*(1.-2.*s)+s)); return; }
  if (u_type==20) { vec2 q=(uv-0.5)*vec2(asp,1.); float r = p*length(vec2(asp,1.))*0.55; o = mix(B(uv), A(uv), smoothstep(r-0.01, r+0.01, length(q))); return; }
  if (u_type==21) { float d = abs(uv.x-0.5)*2.; o = d < p ? B(uv) : A(vec2(uv.x<0.5 ? uv.x+p*0.5 : uv.x-p*0.5, uv.y)); return; }
  if (u_type==26) { float d = (uv.x + uv.y)*0.5; o = mix(A(uv), B(uv), smoothstep(p*1.2-0.1, p*1.2-0.08, 1.-d) ); return; }
  if (u_type==22) { float k = sin(p*3.14159); float band = floor(uv.y*20.); float off = (hash(vec2(band, floor(p*20.)))-0.5)*0.15*k;
    vec2 q = uv+vec2(off,0.); vec4 a = vec4(A(q+vec2(0.01*k,0)).r, A(q).g, A(q-vec2(0.01*k,0)).b, 1.); vec4 b = vec4(B(q+vec2(0.01*k,0)).r, B(q).g, B(q-vec2(0.01*k,0)).b, 1.);
    o = p<0.5 ? a : b; return; }
  if (u_type==23) { float f = 1.-abs(p-0.5)*2.; o = mix(p<0.5?A(uv):B(uv), vec4(1), pow(f,2.)); return; }
  if (u_type==24) { float k = sin(p*3.14159); float n = mix(400., 12., k); vec2 g = vec2(n*asp, n); vec2 q = (floor(uv*g)+0.5)/g; o = p<0.5 ? A(q) : B(q); return; }
  if (u_type==25) { vec2 q=(uv-0.5)*vec2(asp,1.); float k = sin(p*3.14159)*5.; float r=length(q); float ang = k*smoothstep(0.7,0.,r); q = mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*q;
    q = q/vec2(asp,1.)+0.5; o = mix(A(q), B(q), smoothstep(0.4,0.6,p)); return; }
  if (u_type==27) { vec2 q=(uv-0.5)*vec2(asp,1.); float r = length(q); float k = sin(p*3.14159); vec2 d = normalize(q+1e-5)*sin(r*40.-p*20.)*0.02*k;
    o = mix(A(uv+d), B(uv+d), smoothstep(0.3,0.7,p)); return; }
  o = mix(A(uv), B(uv), p);
}`;

export class GL {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This browser has no WebGL2');
    this.gl = gl;
    this.half = !!gl.getExtension('EXT_color_buffer_half_float');
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.p = {
      copy: this.prog(VS_FULL, FS_COPY), solid: this.prog(VS_FULL, FS_SOLID), down: this.prog(VS_FULL, FS_DOWN), gauss: this.prog(VS_FULL, FS_GAUSS),
      color: this.prog(VS_FULL, FS_COLOR), fx: this.prog(VS_FULL, FS_FX), cover: this.prog(VS_FULL, FS_COVER), place: this.prog(VS_QUAD, FS_PLACE),
      trans: this.prog(VS_FULL, FS_TRANS), quadSolid: this.prog(VS_QUAD, FS_SOLID),
    };
    this.pool = [];      // free render targets
    this.used = [];      // targets handed out this frame
    this.srcTex = new Map(); // key -> {t,w,h,ver}
    this.white = this.makeTex(1, 1, new Uint8Array([255, 255, 255, 255]));
  }
  prog(vs, fs) {
    const gl = this.gl, mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => i + 1 + ': ' + l).join('\n').slice(0, 3000));
      return s;
    };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'a_pos'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); const name = info.name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  makeTex(w, h, data = null) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return { t, w, h };
  }
  // render target from the pool (released at endFrame)
  target(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const gl = this.gl;
    let i = this.pool.findIndex(r => r.w === w && r.h === h), r;
    if (i >= 0) r = this.pool.splice(i, 1)[0];
    else {
      r = this.makeTex(w, h);
      r.fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, r.fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, r.t, 0);
    }
    this.used.push(r);
    return r;
  }
  release(r) { const i = this.used.indexOf(r); if (i >= 0) { this.used.splice(i, 1); this.pool.push(r); } }
  endFrame() {
    this.pool.push(...this.used); this.used = [];
    // keep the pool small
    if (this.pool.length > 24) { const gl = this.gl; for (const r of this.pool.splice(0, this.pool.length - 24)) { gl.deleteTexture(r.t); gl.deleteFramebuffer(r.fb); } }
  }
  // uploads a video / image / canvas; `ver` avoids re-uploading unchanged canvases
  source(key, el, w, h, ver = null) {
    const gl = this.gl;
    let s = this.srcTex.get(key);
    if (!s) { s = this.makeTex(1, 1); s.ver = undefined; this.srcTex.set(key, s); }
    if (ver !== null && s.ver === ver && s.w === w && s.h === h) return s;
    gl.bindTexture(gl.TEXTURE_2D, s.t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, el); s.w = w; s.h = h; s.ver = ver; s.ok = true; }
    catch (e) { s.ok = false; }
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    return s;
  }
  dropSource(key) { const s = this.srcTex.get(key); if (s) { this.gl.deleteTexture(s.t); this.srcTex.delete(key); } }
  dropSourcesExcept(keep) { for (const k of [...this.srcTex.keys()]) if (!keep.has(k)) this.dropSource(k); }

  use(prog, dst) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    if (dst) { gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb); gl.viewport(0, 0, dst.w, dst.h); }
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.canvas.width, this.canvas.height); }
    gl.bindVertexArray(this.vao);
    return prog.u;
  }
  bind(unit, tex, loc) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.uniform1i(loc, unit); }
  draw() { this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4); }
  noBlend() { this.gl.disable(this.gl.BLEND); }
  normalBlend() { const gl = this.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }

  clear(dst, r = 0, g = 0, b = 0, a = 1) {
    const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, dst ? dst.fb : null);
    gl.viewport(0, 0, dst ? dst.w : this.canvas.width, dst ? dst.h : this.canvas.height);
    gl.clearColor(r, g, b, a); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  copy(src, dst, flip = false, alpha = 1, blend = false) {
    const u = this.use(this.p.copy, dst);
    blend ? this.normalBlend() : this.noBlend();
    this.bind(0, src, u.u_tex); this.gl.uniform1f(u.u_flip, flip ? 1 : 0); this.gl.uniform1f(u.u_alpha, alpha); this.draw();
    this.noBlend();
  }
  present(src) {
    const c = this.canvas;
    if (c.width !== src.w || c.height !== src.h) { c.width = src.w; c.height = src.h; }
    this.copy(src, null, true);
  }

  // blurred copy: halves down to the wanted scale (true averages), then a gaussian at the small size
  blurred(src, scale, passes = 2) {
    let cur = src, w = src.w, h = src.h;
    const tw = Math.max(2, src.w * scale), th = Math.max(2, src.h * scale);
    while (w / 2 >= tw * 0.999 && h / 2 >= th * 0.999 && w > 2 && h > 2) {
      const nw = Math.max(1, Math.round(w / 2)), nh = Math.max(1, Math.round(h / 2)), d = this.target(nw, nh);
      const u = this.use(this.p.down, d); this.noBlend();
      this.bind(0, cur, u.u_tex); this.gl.uniform2f(u.u_px, 1 / w, 1 / h); this.draw();
      if (cur !== src) this.release(cur);
      cur = d; w = nw; h = nh;
    }
    if (cur === src) { const d = this.target(w, h); this.copy(src, d); cur = d; }
    for (let i = 0; i < passes; i++) {
      for (const dir of [[1 / w, 0], [0, 1 / h]]) {
        const d = this.target(w, h), u = this.use(this.p.gauss, d); this.noBlend();
        this.bind(0, cur, u.u_tex); this.gl.uniform2f(u.u_dir, dir[0], dir[1]); this.draw();
        this.release(cur); cur = d;
      }
    }
    return cur;
  }

  // colour pass: adjustments (+filter), chroma key, cut-out mask
  color(src, o) {
    const gl = this.gl, d = this.target(src.w, src.h), u = this.use(this.p.color, d); this.noBlend();
    this.bind(0, src, u.u_tex); this.bind(1, o.mask || this.white, u.u_mask);
    gl.uniform2f(u.u_res, src.w, src.h); gl.uniform1f(u.u_t, o.t || 0);
    gl.uniform1fv(u.u_adj, o.adj);
    gl.uniform3fv(u.u_sh, o.sh || [0.5, 0.5, 0.5]); gl.uniform3fv(u.u_hi, o.hi || [0.5, 0.5, 0.5]); gl.uniform1f(u.u_tone, o.tone || 0); gl.uniform1f(u.u_mono, o.mono || 0);
    const k = o.key; gl.uniform4f(u.u_key, k ? 1 : 0, k ? k.sim : 0, k ? k.smooth : 0, k ? k.spill : 0); gl.uniform3fv(u.u_keyc, k ? k.rgb : [0, 1, 0]);
    gl.uniform1f(u.u_useMask, o.mask ? 1 : 0); gl.uniform1f(u.u_maskInv, o.maskInv ? 1 : 0);
    this.draw();
    return d;
  }
  fx(src, type, a, b, t, blur = null, seed = 0) {
    const gl = this.gl, d = this.target(src.w, src.h), u = this.use(this.p.fx, d); this.noBlend();
    this.bind(0, src, u.u_tex); this.bind(1, blur || src, u.u_blur);
    gl.uniform2f(u.u_res, src.w, src.h); gl.uniform1f(u.u_t, t); gl.uniform1f(u.u_a, a); gl.uniform1f(u.u_b, b ?? 1); gl.uniform1i(u.u_type, type); gl.uniform1f(u.u_seed, seed);
    this.draw();
    return d;
  }
  // regions: [{x,y,w,h (px, centre-based half sizes), shape 0 ellipse 1 rounded 2 box, feather, style 0 blur 1 mosaic 2 solid 3 frosted, angle}]
  cover(src, regions, o) {
    const gl = this.gl;
    let maxSize = 0; for (const r of regions) maxSize = Math.max(maxSize, Math.max(r.hw, r.hh) * 2);
    // blur strong enough that a face keeps only a few colour patches across it
    const across = o.style === 1 ? o.blocks : (3 + (1 - o.strength) * 14);
    const scale = Math.min(0.5, Math.max(across / Math.max(8, maxSize), 1 / 256));
    const blur = o.style === 2 ? null : this.blurred(src, scale, o.style === 1 ? 0 : 2);
    const d = this.target(src.w, src.h), u = this.use(this.p.cover, d); this.noBlend();
    this.bind(0, src, u.u_tex); this.bind(1, blur || src, u.u_blur);
    gl.uniform2f(u.u_res, src.w, src.h);
    const n = Math.min(MAXR, regions.length), R = new Float32Array(MAXR * 4), S = new Float32Array(MAXR * 4);
    for (let i = 0; i < n; i++) {
      const r = regions[i];
      R.set([r.x, r.y, r.hw, r.hh], i * 4); S.set([r.shape ?? 0, r.feather ?? 0.3, r.style ?? o.style, r.angle || 0], i * 4);
    }
    gl.uniform1i(u.u_n, n); gl.uniform4fv(u.u_r, R); gl.uniform4fv(u.u_rs, S);
    const c = o.color || [0, 0, 0]; gl.uniform4f(u.u_col, c[0], c[1], c[2], 1);
    gl.uniform1f(u.u_blocks, o.blocks || 8); gl.uniform1f(u.u_t, o.t || 0); gl.uniform1f(u.u_invert, o.invert ? 1 : 0);
    this.draw();
    if (blur) this.release(blur);
    return d;
  }
  // draws `src` onto `dst` with a 3x3 matrix mapping local uv (0..1, y down) to dst pixels
  place(src, dst, m, o = {}) {
    const gl = this.gl, blend = o.blend || 0;
    let back = null;
    if (blend) { back = this.target(dst.w, dst.h); this.copy(dst, back); }
    const u = this.use(this.p.place, dst);
    blend ? this.noBlend() : this.normalBlend();
    // pixels -> clip space (rows top-first)
    const W = dst.w, H = dst.h, M = [
      m[0] * 2 / W, m[1] * 2 / H, 0,
      m[3] * 2 / W, m[4] * 2 / H, 0,
      m[6] * 2 / W - 1, m[7] * 2 / H - 1, 1];
    gl.uniformMatrix3fv(u.u_m, false, M);
    this.bind(0, src, u.u_tex); this.bind(1, back || src, u.u_dst);
    const cr = o.crop || [0, 0, 1, 1]; gl.uniform4f(u.u_crop, cr[0], cr[1], cr[2], cr[3]);
    gl.uniform1f(u.u_op, o.opacity ?? 1); gl.uniform1i(u.u_blend, blend); gl.uniform1i(u.u_useDst, blend ? 1 : 0);
    const mk = o.mask;
    gl.uniform1i(u.u_mask, mk ? mk.type : 0);
    gl.uniform4f(u.u_mk, mk ? mk.x : 0.5, mk ? mk.y : 0.5, mk ? mk.w : 0.5, mk ? mk.h : 0.5);
    gl.uniform4f(u.u_mk2, mk ? mk.angle : 0, mk ? mk.feather : 0, mk?.invert ? 1 : 0, mk ? mk.round : 0);
    gl.uniform2f(u.u_size, o.size?.[0] || src.w, o.size?.[1] || src.h);
    const wp = o.wipe || [0, 0, 1, 1]; gl.uniform4f(u.u_wipe, wp[0], wp[1], wp[2], wp[3]);
    gl.uniform1f(u.u_flipX, o.flipX ? 1 : 0); gl.uniform1f(u.u_flipY, o.flipY ? 1 : 0);
    this.draw();
    this.noBlend();
    if (back) this.release(back);
  }
  fillRect(dst, m, rgba) {
    const gl = this.gl, u = this.use(this.p.quadSolid, dst); this.normalBlend();
    const W = dst.w, H = dst.h;
    gl.uniformMatrix3fv(u.u_m, false, [m[0] * 2 / W, m[1] * 2 / H, 0, m[3] * 2 / W, m[4] * 2 / H, 0, m[6] * 2 / W - 1, m[7] * 2 / H - 1, 1]);
    gl.uniform4f(u.u_c, rgba[0] * rgba[3], rgba[1] * rgba[3], rgba[2] * rgba[3], rgba[3]); this.draw(); this.noBlend();
  }
  trans(a, b, type, p) {
    const gl = this.gl, d = this.target(a.w, a.h), u = this.use(this.p.trans, d); this.noBlend();
    this.bind(0, a, u.u_a); this.bind(1, b, u.u_b);
    gl.uniform1f(u.u_p, p); gl.uniform1i(u.u_type, type); gl.uniform2f(u.u_res, a.w, a.h);
    this.draw();
    return d;
  }
  read(src, x = 0, y = 0, w = 1, h = 1) {
    const gl = this.gl, out = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, src.fb); gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }
}

// matrix helpers (column-major 3x3 for local uv -> pixels)
export function placeMatrix(cx, cy, w, h, rotDeg) {
  const a = rotDeg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // p = C + R * ((uv - .5) * size)
  const m00 = c * w, m01 = s * w, m10 = -s * h, m11 = c * h;
  return [m00, m01, 0, m10, m11, 0, cx - 0.5 * m00 - 0.5 * m10, cy - 0.5 * m01 - 0.5 * m11, 1];
}
