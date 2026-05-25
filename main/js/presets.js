// presets.js — built-in scenarios, all velocities recalculated for G=1.9844e-5
//
// Formula: circular orbit v = sqrt(G * M_central / r)
// G = 1.9844e-5  AU³ yr⁻² (1e24 kg)⁻¹
// Earth mass = 6 units, Sun mass = 1,989,000 units
// 1 AU/yr = 4.740 km/s  (corrected: AU_km/yr_s = 1.496e8/3.156e7)

export const PRESETS = [
  {
    id: 'solar-system',
    name: 'Solar System',
    desc: 'Sun with Earth, Mars, and Jupiter in stable circular orbits.',
    bodies: 4,
    bodies_data: [
      // v = sqrt(G * 1989000 / r)
      // Earth   r=1.00:  v = 6.283
      // Mars    r=1.52:  v = 5.096
      // Jupiter r=5.20:  v = 2.755
      { type:'star',   x:0,    y:0,  vx:0,     vy:0,     mass:1989000, radius:0.25,   color:'#FFD060', name:'Sol'     },
      { type:'planet', x:1,    y:0,  vx:0,     vy:6.283, mass:6,       radius:0.07, color:'#4B8FDE', name:'Earth'   },
      { type:'planet', x:1.52, y:0,  vx:0,     vy:5.096, mass:0.642,   radius:0.06, color:'#C1440E', name:'Mars'    },
      { type:'planet', x:5.2,  y:0,  vx:0,     vy:2.755, mass:1898,    radius:0.14, color:'#C88B3A', name:'Jupiter' },
    ]
  },

  {
    id: 'binary-stars',
    name: 'Binary Stars',
    desc: 'Two equal stars locked in a mutual circular orbit.',
    bodies: 2,
    // Each at r=2 AU from CoM. v = sqrt(G*M / (4*r)) = 1.114 AU/yr
    bodies_data: [
      { type:'star', x:-2, y:0, vx:0,  vy:-1.114, mass:500000, radius:0.22, color:'#FFD060', name:'Alpha' },
      { type:'star', x: 2, y:0, vx:0,  vy: 1.114, mass:500000, radius:0.22, color:'#FF8C40', name:'Beta'  },
    ]
  },

  {
    id: 'three-body',
    name: 'Chaotic Three-Body',
    desc: 'Three equal masses in an equilateral triangle — starts periodic, becomes chaotic.',
    bodies: 3,
    // Equilateral triangle, sep=4 AU, CoM at origin
    // Positions: (-2,-1.155), (2,-1.155), (0,2.309)
    // Velocities tangential (CCW), v_orbit = 2.227 AU/yr
    bodies_data: [
      { type:'star', x:-2, y:-1.155, vx: 1.114, vy:-1.929, mass:1000000, radius:0.20, color:'#FF6060', name:'Red'   },
      { type:'star', x: 2, y:-1.155, vx: 1.114, vy: 1.929, mass:1000000, radius:0.20, color:'#60C0FF', name:'Blue'  },
      { type:'star', x: 0, y: 2.309, vx:-2.227, vy: 0,     mass:1000000, radius:0.20, color:'#80FF80', name:'Green' },
    ]
  },

  {
    id: 'figure8',
    name: 'Figure-8 Orbit',
    desc: 'Chenciner–Montgomery solution (2000). Three equal masses trace a figure-8 forever.',
    bodies: 3,
    // Scaled from normalized Chenciner-Montgomery with M=300000, G=1.9844e-5
    // scale = sqrt(G*M) = 2.4399
    // Normalized positions (Simo 2002): (-1,0),(1,0),(0,0)  at t=0
    // Normalized velocities: (0.3069,-0.1255) for body1, (0.3069,-0.1255) for body2, (-0.6138,0.2510) for body3
    bodies_data: [
      { type:'star', x:-1, y:0, vx: 0.749, vy:-0.306, mass:300000, radius:0.14, color:'#FF9050', name:'A' },
      { type:'star', x: 1, y:0, vx: 0.749, vy:-0.306, mass:300000, radius:0.14, color:'#50C0FF', name:'B' },
      { type:'star', x: 0, y:0, vx:-1.498, vy: 0.612, mass:300000, radius:0.14, color:'#C050FF', name:'C' },
    ]
  },

  {
    id: 'planet-moon',
    name: 'Planet + Moon',
    desc: 'A gas giant with a moon, both orbiting a star. Both orbits stay stable.',
    bodies: 3,
    // Giant at 5 AU: v = sqrt(G*1989000/5) = 2.810 AU/yr
    // Moon at 0.35 AU from giant: v_giant + sqrt(G*1898/0.35) = 2.810 + 0.328 = 3.138
    bodies_data: [
      { type:'star',   x:0,    y:0,  vx:0,    vy:0,     mass:1989000, radius:0.25,   color:'#FFD060', name:'Sun'   },
      { type:'planet', x:5,    y:0,  vx:0,    vy:2.810, mass:1898,    radius:0.12, color:'#5090D0', name:'Giant' },
      { type:'planet', x:5.35, y:0,  vx:0,    vy:3.138, mass:6,       radius:0.05,   color:'#AAAACC', name:'Moon'  },
    ]
  },

  {
    id: 'slingshot',
    name: 'Gravity Slingshot',
    desc: 'A small body approaches a massive star and is flung away — gravitational assist.',
    bodies: 2,
    // Traveller starts at (-8,3), moving roughly toward star
    // escape velocity at r=sqrt(64+9)=8.54 is sqrt(2GM/r)=sqrt(2*1.9844e-5*1989000/8.54)=3.03
    // Give it v < escape but at an angle to create hyperbolic flyby
    bodies_data: [
      { type:'star',   x:0,  y:0, vx:0,   vy:0,    mass:1989000, radius:0.25,   color:'#FFD060', name:'Massive Star' },
      { type:'planet', x:-8, y:3, vx:2.2, vy:-0.4, mass:1,       radius:0.06, color:'#80E0A0', name:'Traveller'    },
    ]
  },

  {
    id: 'galactic-collision',
    name: 'Galactic Collision',
    desc: 'Two star clusters on a collision course. Watch them pass through and merge.',
    bodies: 14,
    bodies_data: (() => {
      const G = 1.9844e-5;
      const result = [];
      const Mcore = 5000000;
      // Left cluster moving right
      result.push({ type:'star', x:-8, y:0, vx:0.8, vy:0, mass:Mcore, radius:0.25, color:'#FFD060', name:'Core A' });
      const orbitV_A = Math.sqrt(G * Mcore / 3); // orbital v at r=3 around core
      for (let i = 0; i < 6; i++) {
        const a = (i * 60 * Math.PI) / 180;
        const px = -8 + Math.cos(a)*3, py = Math.sin(a)*3;
        // Tangential velocity + cluster drift
        result.push({
          type:'planet', x:px, y:py,
          vx: 0.8 - Math.sin(a)*orbitV_A,
          vy:       Math.cos(a)*orbitV_A,
          mass:50, radius:0.06, color:'#FF9060', name:'A'+i
        });
      }
      // Right cluster moving left
      result.push({ type:'star', x:8, y:0, vx:-0.8, vy:0, mass:Mcore, radius:0.25, color:'#60C0FF', name:'Core B' });
      const orbitV_B = Math.sqrt(G * Mcore / 3);
      for (let i = 0; i < 6; i++) {
        const a = ((i * 60 + 30) * Math.PI) / 180;
        const px = 8 + Math.cos(a)*3, py = Math.sin(a)*3;
        result.push({
          type:'planet', x:px, y:py,
          vx: -0.8 - Math.sin(a)*orbitV_B,
          vy:        Math.cos(a)*orbitV_B,
          mass:50, radius:0.06, color:'#60D0FF', name:'B'+i
        });
      }
      return result;
    })()
  },

  {
    id: 'rogue-planet',
    name: 'Rogue Planet',
    desc: 'A rogue planet tears through a solar system. Steal, eject, or pass through?',
    bodies: 4,
    bodies_data: [
      { type:'star',   x:0,   y:0,  vx:0,   vy:0,     mass:1989000, radius:0.25,   color:'#FFD060', name:'Sun'    },
      { type:'planet', x:1,   y:0,  vx:0,   vy:6.283, mass:6,       radius:0.07, color:'#4B8FDE', name:'Earth'  },
      { type:'planet', x:2.5, y:0,  vx:0,   vy:3.974, mass:10,      radius:0.08, color:'#C88B3A', name:'Saturn' },
      // Rogue starts far left, moving right on a flyby trajectory
      { type:'planet', x:-14, y:2,  vx:2.8, vy:0.1,   mass:5000,    radius:0.11, color:'#AA60FF', name:'Rogue'  },
    ]
  },

  // ── Phase 5: Exotic bodies ──────────────────────────────

  {
    id: 'black-hole-flyby',
    name: 'Black Hole Flyby',
    desc: 'A stellar black hole drifts past a solar system. Watch it warp orbits and spaghettify anything that gets too close.',
    bodies: 4,
    bodies_data: [
      { type:'star',      x:0,   y:0,  vx:0,    vy:0,     mass:1989000,  radius:0.25, physicsRadius:0.08,  color:'#FFD060', name:'Sun'    },
      { type:'planet',    x:1,   y:0,  vx:0,    vy:6.284, mass:6,        radius:0.08, physicsRadius:0.015, color:'#4B8FDE', name:'Earth'  },
      { type:'planet',    x:2.5, y:0,  vx:0,    vy:3.974, mass:10,       radius:0.10, physicsRadius:0.018, color:'#C88B3A', name:'Jupiter'},
      { type:'blackhole', x:-12, y:3,  vx:2.5,  vy:0.2,   mass:19890000, radius:0.06, physicsRadius:0.04,  color:'#8B5CF6', name:'Nemesis'},
    ]
  },

  {
    id: 'pulsar-system',
    name: 'Pulsar System',
    desc: 'A rapidly spinning pulsar with planets in tight orbits. Watch the beams sweep through space.',
    bodies: 3,
    bodies_data: [
      { type:'pulsar',    x:0,   y:0,  vx:0,    vy:0,     mass:2785000,  radius:0.04, physicsRadius:0.02,  color:'#80FFCC', name:'PSR-1'  },
      { type:'planet',    x:0.8, y:0,  vx:0,    vy:9.96,  mass:6,        radius:0.08, physicsRadius:0.015, color:'#FF6060', name:'Scorch' },
      { type:'planet',    x:2.0, y:0,  vx:0,    vy:6.28,  mass:20,       radius:0.10, physicsRadius:0.018, color:'#8080FF', name:'Tide'   },
    ]
  },

  {
    id: 'comet-storm',
    name: 'Comet Storm',
    desc: 'A star with a swarm of comets on highly elliptic orbits. Watch the comas ignite at perihelion.',
    bodies: 6,
    bodies_data: [
      { type:'star',  x:0,     y:0,   vx:0,    vy:0,     mass:1989000, radius:0.25, physicsRadius:0.08,  color:'#FFD060', name:'Sol'    },
      { type:'comet', x:0.6,   y:0,   vx:0,    vy:14.5,  mass:0.0001,  radius:0.025,physicsRadius:0.008, color:'#C8E8FF', name:'C/1'    },
      { type:'comet', x:0.8,   y:0.3, vx:-3.0, vy:12.0,  mass:0.0001,  radius:0.025,physicsRadius:0.008, color:'#A0D4FF', name:'C/2'    },
      { type:'comet', x:-1.0,  y:0.5, vx:2.5,  vy:-10.5, mass:0.0001,  radius:0.025,physicsRadius:0.008, color:'#80C8FF', name:'C/3'    },
      { type:'comet', x:0.5,  y:-0.8, vx:4.0,  vy:11.0,  mass:0.0001,  radius:0.025,physicsRadius:0.008, color:'#B0DCFF', name:'C/4'    },
      { type:'comet', x:-0.7,  y:-0.4,vx:3.5,  vy:-12.5, mass:0.0001,  radius:0.025,physicsRadius:0.008, color:'#90D0FF', name:'C/5'    },
    ]
  },

  {
    id: 'neutron-binary',
    name: 'Neutron Star Binary',
    desc: 'Two neutron stars spiralling around each other — a gravitational wave source. Real physics, extreme gravity.',
    bodies: 2,
    bodies_data: [
      // v = sqrt(G*M / (4*r)) — each at r=1 AU from CoM
      { type:'neutronstar', x:-1, y:0, vx:0, vy:-Math.sqrt(1.9855e-5 * 2785000 / 4), mass:2785000, radius:0.04, physicsRadius:0.02, color:'#A0EFFF', name:'NS-A' },
      { type:'neutronstar', x: 1, y:0, vx:0, vy: Math.sqrt(1.9855e-5 * 2785000 / 4), mass:2785000, radius:0.04, physicsRadius:0.02, color:'#60D0FF', name:'NS-B' },
    ]
  },
];