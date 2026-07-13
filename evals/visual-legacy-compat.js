'use strict';

// The repository-wide Ambient Evidence rollout changes shared infrastructure
// and adds evidence-only game code without changing reviewed pixels. Legacy
// receipts may project only these exact rollout bytes back to the reviewed
// revision. Any later mutation falls back to current bytes and invalidates the
// receipt; visual suites, references, renderer locks, fonts, and consumed
// baselines always hash from the working tree.
module.exports={
  baseRevision:'a16ab80e19dd7605f650005375eb3c78d56c29dc',
  projectedPaths:new Map([
    ['engine.js','a73d506c3ea8390c7b46e2cf43b6c20db764bf3a07c1483ec91229268417b376'],
    ['evals/harness.js','eda4fd97c9af34e3a9393faa47d386f7155c95a7ff7cda78d69bec8bca269984'],
    ['render/runtime.js','faaf22c505bb97082afda669809873a48303fb449c9cc831b1f1d11c51e295e5']
  ]),
  gameHashes:{
    'ghost-shift':{reviewed:'8104a4a6527fbdbae48e204a1c05398c86c7e7759accb36317129624c34fb941',rollout:'dc2ef7ac317c1306369fca8b3c1272682e3ffa1e58b76fc16943e6ede0ab7771'},
    'pico-cap':{reviewed:'369019ea13834df83789aac7ce56ec44783ada150b1ffa485ffddb9e25076e60',rollout:'6714be9073f22f6f7bcfa9df7e8cc70377189da94862dae03f8f40e1501625b7'},
    'dungeon-express':{reviewed:'0c445729bde5e655d1aec82876eea79a1d3b8f46c2c6152766c44b40c24a1e14',rollout:'ffe8f56c183846046aadeeb6ca7e29ca585b21443382b0b4d7e8fec51f0c09d2'},
    'tower-panic':{reviewed:'30309a8b6ed4a1d2800d1de5344a2056d1ff1a89fcffbfa4c3cfedeab55f9570',rollout:'c9b437bd5d000395e4662a2449457fca3d0f4d3b6fe1432b0f45430070e3762c'}
  },
  receipts:{
    'dungeon-express':{
      reviewIdentitySha256:'c0592a05d20adbbeffdfb2fc32df1b8efd4dca01ff6e40d3f8d9f6b8fdeb39e8',
      sourceIdentitySha256:'3c39b4b0313e9bde443cbbe7f35b3d3974b21e13637089937ce38b078412ae69'
    },
    'ghost-shift':{
      reviewIdentitySha256:'582e51f71d454f2da2b460254651edd4e09fd91c6a36113d7abec18180c99141',
      sourceIdentitySha256:'4062fe213468c953b3cca7a48cd90d3f17f6befc1b67866622d1a9582fb2c721'
    },
    'pico-cap':{
      reviewIdentitySha256:'3c5c4be767b3ef22c7dbc147b3fc9cece8174b2fca0d16b79a47cc9ba1f58141',
      sourceIdentitySha256:'a660ee0f2a96da1d01c5e64adb740baa6d2b6655e2ff340d23bb14f1214b4afb'
    },
    'tower-panic':{
      reviewIdentitySha256:'09b8b4332fca7c110861750528dc29d2f8e69d08b64336e4e1400087c8f69674',
      sourceIdentitySha256:'4028e26123bdfbb6e410f1d89be0f9fe404150cbc01fde7592b9699324145435'
    }
  }
};
