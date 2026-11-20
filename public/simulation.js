'use strict';
(function(root){
function calculateIndoorPM25(input){
 if(!input||typeof input!=='object')throw new TypeError('Simulation inputs are required.');
 const {C0,Co,V,lambda,P,k,CADR,source,t}=input,values=[C0,Co,V,lambda,P,k,CADR,source,t];
 if(values.some(v=>!Number.isFinite(v)))throw new RangeError('All simulator inputs must be finite numbers.');
 if(C0<0||Co<0||V<=0||lambda<0||P<0||P>1||k<0||CADR<0||source<0||t<0)throw new RangeError('Simulator inputs are outside their valid ranges.');
 const indoor=source/V,filter=CADR/V;
 if(![indoor,filter].every(Number.isFinite))throw new RangeError('These input magnitudes exceed the simulator numeric range. Reduce the rates or source.');
 const scale=Math.max(lambda,k,filter,indoor,1),den=lambda/scale+k/scale+filter/scale,K=scale*den;
 if(!Number.isFinite(K))throw new RangeError('Combined removal rate is too large. Reduce the rate inputs.');
 const scaledOutdoor=(lambda/scale)*P*Co;
 const scaledIndoor=indoor/scale;
 const scaledA=scaledOutdoor+scaledIndoor;
 const A=K===0?P*lambda*Co+indoor:(Number.isFinite(scaledA*scale)?scaledA*scale:null);
 const noRemoval=K===0,equilibrium=noRemoval?(A===0?'non-unique':'none'):'unique';
 let steadyState=null,at=time=>C0+A*time;
 if(!noRemoval){
  steadyState=scaledA/den;
  if(!Number.isFinite(steadyState))throw new RangeError('The calculated steady state is outside the supported numeric range.');
  at=time=>C0+(steadyState-C0)*(-Math.expm1(-K*time));
 }
 const concentration=at(t);if(!Number.isFinite(concentration)||concentration<0)throw new RangeError('The calculated concentration is outside the supported numeric range.');
 const t90SteadyStateMinutes=noRemoval?null:Math.log(10)/K*60;let t90AbsoluteMinutes=null;
 if(!noRemoval&&C0>0&&steadyState<.1*C0&&steadyState<C0){const ratio=(.1*C0-steadyState)/(C0-steadyState);t90AbsoluteMinutes=-Math.log(ratio)/K*60;}
 const timeSeries=Array.from({length:25},(_,i)=>{const time=t*i/24,value=at(time);if(!Number.isFinite(value)||value<0)throw new RangeError('The time series exceeds the supported numeric range.');return {time,concentration:value};});
 return {A,K,steadyState,equilibrium,concentration,timeSeries,t90SteadyStateMinutes,t90AbsoluteMinutes};
}
root.AirLabSimulation=Object.freeze({calculateIndoorPM25});
}(typeof globalThis!=='undefined'?globalThis:window));
