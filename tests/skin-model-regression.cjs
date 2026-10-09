const assert=require('node:assert/strict');
(async()=>{
  const THREE=await import('../assets/vendor/three/three.module.min.mjs');
  const {SPECIES,createIllustration,disposeIllustration}=await import('../src/features/skin/skin-models.mjs');
  const materials={};for(const channel of ['skin','underbelly','mouth','eyes','pupil','shine','claws','detail1','male_display','teeth','flank'])materials[channel]=new THREE.MeshStandardMaterial();
  let meshes=0,maxTriangles=0;
  for(const species of Object.keys(SPECIES)){
    const model=createIllustration(species,materials);
    const box=new THREE.Box3().setFromObject(model);assert.ok(!box.isEmpty(),species);
    assert.ok(box.min.y>-.1&&box.max.y<5,species+' height');
    let triangles=0;
    model.traverse(object=>{
      if(!object.isMesh)return;meshes++;
      const g=object.geometry,p=g.attributes.position,n=g.attributes.normal,uv=g.attributes.uv;
      assert.ok(p&&n&&uv,species+' attributes');assert.equal(p.count,n.count);assert.equal(p.count,uv.count);
      for(const buffer of [p,n,uv])assert.ok([...buffer.array].every(Number.isFinite),species+' finite geometry');
      if(g.index)for(const index of g.index.array)assert.ok(index>=0&&index<p.count);
      triangles+=(g.index?.count||p.count)/3;
    });
    assert.ok(triangles<90000,species+' triangle budget');maxTriangles=Math.max(maxTriangles,triangles);
    disposeIllustration(model);
  }
  Object.values(materials).forEach(material=>material.dispose());
  console.log(`PASS ${Object.keys(SPECIES).length} original species, ${meshes} surfaces, valid bounds/indices/UV/normals; max ${maxTriangles} triangles`);
})().catch(error=>{console.error(error);process.exitCode=1;});
