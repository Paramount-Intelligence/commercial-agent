'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { mapOrbState, smoothOrbLevel, type OrbConversationState } from '@/lib/voice/orbMotion';

type Props = {
  state: OrbConversationState;
  microphoneLevel?: number;
  outputLevel?: number;
  size?: number;
  staticFrame?: boolean;
  className?: string;
};

const VERTEX = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0.,1.);}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 v_uv; out vec4 outColor;
uniform float u_time; uniform float u_level; uniform float u_mode; uniform float u_ice; uniform float u_violet;
vec3 mod289(vec3 x){return x-floor(x*(1./289.))*289.;}
vec2 mod289(vec2 x){return x-floor(x*(1./289.))*289.;}
vec3 permute(vec3 x){return mod289(((x*34.)+10.)*x);}
float snoise(vec2 v){
 const vec4 C=vec4(.2113248654,.3660254038,-.5773502692,.0243902439);
 vec2 i=floor(v+dot(v,C.yy)); vec2 x0=v-i+dot(i,C.xx);
 vec2 i1=x0.x>x0.y?vec2(1.,0.):vec2(0.,1.);
 vec4 x12=x0.xyxy+C.xxzz; x12.xy-=i1; i=mod289(i);
 vec3 p=permute(permute(i.y+vec3(0.,i1.y,1.))+i.x+vec3(0.,i1.x,1.));
 vec3 m=max(.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.); m=m*m;m=m*m;
 vec3 x=2.*fract(p*C.www)-1.; vec3 h=abs(x)-.5; vec3 ox=floor(x+.5); vec3 a0=x-ox;
 m*=1.792842914-.853734721*(a0*a0+h*h);
 vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;
 return 130.*dot(m,g);
}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){
 vec2 p=v_uv*2.-1.; float r=length(p); float edge=1.-smoothstep(.91,1.,r);
 float t=u_time*(.16+u_level*.62)+(u_mode==2.?u_time*.12:0.);
 vec2 warp=vec2(snoise(p*1.55+vec2(t,-t*.7)),snoise(p*1.7+vec2(-t*.55,t*.8)));
 float n=snoise(p*2.25+warp*.62+vec2(t*.42,-t*.3))*.5+.5;
 vec3 deep=vec3(.043,.165,.357), paramount=vec3(.09,.349,.616), brand=vec3(.118,.435,.851);
 vec3 sky=vec3(.31,.639,1.), ice=vec3(.839,.918,1.), silver=vec3(.788,.82,.863), violet=vec3(.486,.424,1.);
 vec3 color=mix(deep,paramount,smoothstep(.08,.58,n)); color=mix(color,brand,smoothstep(.4,.86,n));
 float light=smoothstep(.9,.06,length(p-vec2(-.35,.42))); color=mix(color,mix(silver,ice,u_ice),light*(.19+u_ice*.27));
 color=mix(color,sky,smoothstep(.42,.9,n)*u_ice*.42);
 float vein=1.-smoothstep(.015,.075,abs(snoise(p*3.2+warp+t*.18)-.13)); color=mix(color,violet,vein*u_violet*.58);
 color*=1.-smoothstep(.34,1.,-p.y)*smoothstep(.55,.96,r)*.38;
 color+=(hash(gl_FragCoord.xy+u_time*17.)-.5)*.04;
 outColor=vec4(color,edge);
}`;

function shader(gl: WebGL2RenderingContext, kind: number, source: string) {
  const item = gl.createShader(kind);
  if (!item) return null;
  gl.shaderSource(item, source); gl.compileShader(item);
  if (!gl.getShaderParameter(item, gl.COMPILE_STATUS)) { gl.deleteShader(item); return null; }
  return item;
}

export default function VoiceOrb({ state, microphoneLevel = 0, outputLevel = 0, size = 260, staticFrame = false, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const valuesRef = useRef({ state, microphoneLevel, outputLevel });
  const [fallback, setFallback] = useState(false);
  valuesRef.current = { state, microphoneLevel, outputLevel };

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: true, powerPreference: 'low-power' });
    if (!gl) { setFallback(true); return; }
    const vs = shader(gl, gl.VERTEX_SHADER, VERTEX); const fs = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    const program = gl.createProgram();
    if (!vs || !fs || !program) { setFallback(true); return; }
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { setFallback(true); return; }
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniforms = {
      time: gl.getUniformLocation(program, 'u_time'), level: gl.getUniformLocation(program, 'u_level'),
      mode: gl.getUniformLocation(program, 'u_mode'), ice: gl.getUniformLocation(program, 'u_ice'), violet: gl.getUniformLocation(program, 'u_violet'),
    };
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let visible = !document.hidden; let intersecting = true; let frame = 0; let previous = performance.now(); let smooth = 0; let clock = 0;
    const resize = () => { const dpr=Math.min(2,window.devicePixelRatio||1); const px=Math.round(wrapper.clientWidth*dpr); if(canvas.width!==px){canvas.width=px;canvas.height=px;gl.viewport(0,0,px,px);} };
    const draw = (now: number) => {
      const elapsed=Math.min(64,now-previous); previous=now; const current=valuesRef.current;
      const mapped=mapOrbState(current.state,current.microphoneLevel,current.outputLevel);
      smooth=smoothOrbLevel(smooth,mapped.level,elapsed); if(!reduced&&!staticFrame) clock+=elapsed*mapped.speed/1000;
      resize(); gl.uniform1f(uniforms.time,clock);gl.uniform1f(uniforms.level,smooth);gl.uniform1f(uniforms.mode,mapped.mode);gl.uniform1f(uniforms.ice,mapped.ice);gl.uniform1f(uniforms.violet,mapped.violet);
      wrapper.style.setProperty('--orb-scale', String(reduced ? 1 : mapped.scale)); gl.drawArrays(gl.TRIANGLES,0,6);
      if(visible&&intersecting&&!staticFrame) frame=requestAnimationFrame(draw);
    };
    const start=()=>{if(!frame&&visible&&intersecting)frame=requestAnimationFrame(draw);};
    const onVisibility=()=>{visible=!document.hidden;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}else start();};
    const observer=new IntersectionObserver(([entry])=>{intersecting=Boolean(entry?.isIntersecting);if(!intersecting&&frame){cancelAnimationFrame(frame);frame=0;}else start();});
    observer.observe(wrapper); document.addEventListener('visibilitychange',onVisibility); start();
    return()=>{if(frame)cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',onVisibility);gl.deleteProgram(program);gl.deleteBuffer(buffer);gl.deleteShader(vs);gl.deleteShader(fs);};
  }, [staticFrame]);

  const mapped = mapOrbState(state, microphoneLevel, outputLevel);
  return (
    <div ref={wrapperRef} className={cn('voice-gradient-orb', fallback && 'is-fallback', staticFrame && 'is-static', className)} style={{ '--orb-size': `${size}px`, '--orb-level': mapped.level } as CSSProperties} role="img" aria-label="Voice conversation">
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="voice-gradient-orb-fallback" aria-hidden="true" />
    </div>
  );
}
