export default () => {
   return {
      enableSceneReloading: true,
      scenes: [ 
            { name: "simple"   , path: "./simple.js"   , public: true },
            { name: "shapes"   , path: "./shapes.js"   , public: true },
            { name: "jointed"  , path: "./jointed.js"  , public: true },
            { name: "interact" , path: "./interact.js" , public: true },
            { name: "beam"     , path: "./beam.js"     , public: true },
            { name: "solarSystem", path: "./solarSystem.js", public: true },
            { name: "spaceSalvage", path: "./spaceSalvage.js", public: true },
            { name: "lines"    , path: "./lines.js"    , public: true },
            { name: "linefont" , path: "./linefont.js" , public: true },
            { name: "orbitalRepairRush", path: "./orbitalRepairRush.js", public: true },
            { name: "beamSphere", path: "./beamSphere.js", public: true },
            { name: "construct" , path: "./construct.js" , public: true },
            { name: "orbitalRepairRushCoOp", path: "./orbitalRepairRushCoOp.js", public: true },
      ]
   };
}
