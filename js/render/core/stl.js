const pending = new Map();

export const binarySTLToMesh = buffer => {
   if (buffer.byteLength < 84) throw new Error('Truncated binary STL');
   const view = new DataView(buffer), count = view.getUint32(80,true);
   if (84+count*50 !== buffer.byteLength) throw new Error('Invalid binary STL length');
   const mesh = new Float32Array(count*3*16);
   for (let i=0;i<count;i++) {
      const offset = 84+i*50;
      const normal = [0,1,2].map(k => view.getFloat32(offset+k*4,true));
      for (let j=0;j<3;j++) {
         const position = [0,1,2].map(k => view.getFloat32(offset+12+j*12+k*4,true));
         if (![...position,...normal].every(Number.isFinite)) throw new Error('Nonfinite STL vertex');
         mesh.set(clay.vertexArray(position,normal), (i*3+j)*16);
      }
   }
   mesh.isTriangles = true;
   return mesh;
};

export function stl(partName) {
   if (clay.formMesh(partName)) return Promise.resolve();
   if (pending.has(partName)) return pending.get(partName);
   const request = loadSTL(partName).finally(() => pending.delete(partName));
   pending.set(partName,request);
   return request;
}

async function loadSTL(partName) {
   try {

      // FETCH THE FILE AND WAIT FOR IT TO LOAD.

      const response = await fetch('media/stl/' + partName + '.stl');
      if (! response.ok)
         throw new Error(`HTTP error: ${response.status}`);

      const buffer = await response.arrayBuffer();
      if (buffer.byteLength >= 84 && 84+new DataView(buffer).getUint32(80,true)*50 === buffer.byteLength) {
         clay.defineMesh(partName,binarySTLToMesh(buffer));
         return;
      }
      const textData = new TextDecoder().decode(buffer);

      // CONVERT FROM ASCII FORMAT TO AN ARRAY OF VERTICES

      let facetData = textData.split('facet ');

      let vertexData = [];
      for (let n = 1 ; n < facetData.length ; n++) {

         let D = facetData[n].split(' ');
	 D = [D[15],D[16],D[17], D[1],D[2],D[3],
	      D[24],D[25],D[26], D[1],D[2],D[3],
	      D[33],D[34],D[35], D[1],D[2],D[3]];

         let V = [];
         for (let i = 0 ; i < D.length ; i++)
	    V[i] = parseFloat(D[i]);
         vertexData.push(V.slice( 0, 6));
         vertexData.push(V.slice( 6,12));
         vertexData.push(V.slice(12,18));
      }

      // CREATE A NEW TRIANGLES MESH TYPE WITH THIS PART NAME.

      clay.defineMesh(partName, clay.trianglesMesh(vertexData));

   } catch (error) {
      console.log('Failed to read stl file:', error);
   }
}
