precision highp float;
attribute float aPlateId;
uniform vec4 uPlateRot[12];
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPlateLocal;
varying float vPlateId;
varying float vElevation;
vec3 qrot(vec3 v,vec4 q){return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
float hash(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z)*2.-1.;}
float fbm(vec3 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*noise(p);p*=2.03;a*=.5;}return s;}
void main(){
  int id=int(aPlateId+.5); vec4 q=uPlateRot[id]; vec3 n=normalize(position);
  vec3 displacedLocal=n; float elevation=fbm(n*2.3)*.028+fbm(n*8.0)*.007;
  displacedLocal=n*(1.0+elevation);
  vec3 displaced=qrot(displacedLocal,q);
  vPlateLocal=n;vPlateId=aPlateId;vElevation=elevation;
  vNormal=normalize(normalMatrix*qrot(n,q));vec4 world=modelMatrix*vec4(displaced,1.0);vWorld=world.xyz;
  gl_Position=projectionMatrix*viewMatrix*world;
}