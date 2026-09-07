precision highp float;
uniform float uYear;
uniform float uHeatmap;
uniform vec3 uPlateSeeds[12];
uniform vec3 uLandCenters[12];
uniform float uLandRadii[12];
varying vec3 vNormal;
varying vec3 vWorld;
varying vec3 vPlateLocal;
varying float vPlateId;
varying float vElevation;
vec3 qrot(vec3 v,vec4 q){return v+2.0*cross(q.xyz,cross(q.xyz,v)+q.w*v);}
float hash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
float plateHue(float id){return .10+.055*mod(id,12.0);}
vec3 plateColor(float id){float h=plateHue(id);return vec3(.12+.55*h,.22+.32*abs(sin(id*2.1)),.16+.42*abs(cos(id*1.7)));}
float landMask(vec3 p,float id){int i=int(id+.5);float d=acos(clamp(dot(p,uLandCenters[i]),-1.,1.));return 1.-smoothstep(uLandRadii[i]*.55,uLandRadii[i],d);}
void main(){
 vec3 p=normalize(vWorld);
 vec3 ocean=vec3(.018,.09,.16);
 vec3 pc=plateColor(vPlateId);
 float land=landMask(normalize(vPlateLocal),vPlateId);
 // Add a second, softer continental component to make large cratons less circular.
 float land2=landMask(normalize(vPlateLocal+vec3(.12,.02,-.08)),vPlateId)*.35;
 land=max(land,land2);
 vec3 base=mix(ocean,pc,land);
 float cold=smoothstep(.48,.90,abs(asin(p.y)));
 base=mix(base,vec3(.88,.90,.86),cold*land);
 // Plate boundaries: compare the two strongest spherical-Voronoi scores.
 float best=-2.,second=-2.;
 for(int i=0;i<12;i++){
   float s=dot(p,uPlateSeeds[i]);
   if(s>best){second=best;best=s;}else if(s>second){second=s;}
 }
 float boundary=1.-smoothstep(.006,.025,best-second);
 base=mix(base,vec3(.92,.72,.18),boundary*.82);
 // Procedural population overlay remains available only during human history.
 float pop=0.;
 if(uYear>=-300000.){
   float hab=exp(-abs(asin(p.y))/.55)*smoothstep(-.01,.03,vElevation);
   pop=hab*smoothstep(-300000.,0.,uYear)*(.65+.35*hash(floor(p*20.)));
 }
 vec3 heat=mix(vec3(.05,.55,.18),vec3(.05,.25,1.),smoothstep(0.,.015,pop));
 heat=mix(heat,vec3(1.,.05,.02),smoothstep(.18,.8,pop));
 base=mix(base,heat,pop*uHeatmap*.82);
 float light=.52+.48*max(dot(vNormal,normalize(vec3(1.5,.7,2.))),0.);
 gl_FragColor=vec4(base*light,1.);
}