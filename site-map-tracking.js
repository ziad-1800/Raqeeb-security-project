/* Pure image-to-plan mapping. Estimated placement is distinct from calibrated placement. */
(function(root) {
  'use strict';
  const active=e=>!['Resolved','False Positive'].includes(e.status);
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  function position(camera,box,width,height) {
    if(!camera||!Array.isArray(box)||box.length!==4||!box.every(Number.isFinite)||!(width>0&&height>0))return null;
    const u=clamp((box[0]+box[2])/(2*width),0,1),v=clamp(box[3]/height,0,1);
    const h=camera.floor_homography;
    if(Array.isArray(h)&&h.length===9&&h.every(Number.isFinite)) {
      const divisor=h[6]*u+h[7]*v+h[8];
      if(Math.abs(divisor)<1e-8)return null;
      return {at:[(h[0]*u+h[1]*v+h[2])/divisor,3,(h[3]*u+h[4]*v+h[5])/divisor],estimated:false};
    }
    if(!Array.isArray(camera.pos)||camera.pos.length!==3)return null;
    const range=Number(camera.range)||300,fov=Number(camera.fov)||65;
    const angle=((Number(camera.yaw)||0)-(u-.5)*fov)*Math.PI/180;
    const distance=range*(.12+.8*(1-v));
    return {at:[camera.pos[0]+Math.sin(angle)*distance,3,camera.pos[2]+Math.cos(angle)*distance],estimated:true};
  }
  function markers({cameras=[],observations=[],incidents=[],placements=[],bindings={},connected=true,now=Date.now()}) {
    if(!connected)return {people:[],incidents:[],unplaced:[]};
    const sourceMap=new Map(cameras.map(c=>[c.id,c]));
    const anchors=new Map(placements.map(c=>[c.id,c]));
    const anchorFor=cid=>anchors.get(bindings[cid]||cid);
    const people=new Map(),seenEvents=new Set(),unplaced=new Set(),alerts=[];
    for(const observation of observations) {
      const camera=sourceMap.get(observation.camera),anchor=anchorFor(observation.camera);
      if(!camera||camera.status==='error'||observation.stale)continue;
      if(!anchor){unplaced.add(camera.id);continue;}
      for(const det of observation.dets||[]) {
        if(det.class!=='person'||!det.id)continue;
        const p=position(anchor,det.box,camera.width,camera.height);if(!p)continue;
        const events=incidents.filter(e=>active(e)&&e.camera===camera.id&&e.person_id===det.id);
        const old=people.get(det.id);
        if(old&&(old.observedAt||0)>(observation.observedAt||0))continue;
        people.set(det.id,{id:det.id,camera:camera.id,...p,alert:events.length>0,
          incidents:events.map(e=>e.id),observedAt:observation.observedAt||now,
          sourceTime:observation.time,paused:observation.paused,kind:'person'});
        events.forEach(e=>seenEvents.add(e.id));
      }
    }
    // An open incident remains at its last observed location even when its person exits view.
    for(const event of incidents) {
      if(!active(event)||seenEvents.has(event.id))continue;
      const camera=sourceMap.get(event.camera),anchor=anchorFor(event.camera);
      if(!camera)continue;
      if(!anchor){unplaced.add(camera.id);continue;}
      const p=position(anchor,event.map_box||event.box,camera.width,camera.height);if(!p)continue;
      const previous=alerts.find(a=>a.camera===event.camera&&a.person_id&&a.person_id===event.person_id);
      if(previous){previous.incidents.push(event.id);continue;}
      alerts.push({id:event.id,person_id:event.person_id,camera:event.camera,...p,incidents:[event.id],
        alert:true,kind:'incident',sourceTime:event.time,incident:event,observedAt:now});
    }
    return {people:[...people.values()],incidents:alerts,unplaced:[...unplaced]};
  }
  root.SiteMapTracking={position,markers};
  if(typeof module!=='undefined'&&module.exports)module.exports=root.SiteMapTracking;
})(typeof window!=='undefined'?window:globalThis);
