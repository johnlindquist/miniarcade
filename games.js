(function(root,factory){
  const games=factory();
  if(typeof module==='object'&&module.exports)module.exports=games;
  root.SIDEQUEST_GAMES=games;
})(typeof globalThis!=='undefined'?globalThis:this,()=>Object.freeze([
  {id:'horizon',title:'MACHINE HUNT',label:'machine hunt',tagline:'zero dawn, zero pixels',tone:'hz'},
  {id:'meatlad',title:'MEAT LAD',label:'meat lad',tagline:"dies so you don't have to",tone:'ml'},
  {id:'rocket',title:'POCKET LEAGUE',label:'pocket league',tagline:'what a save!',tone:'rk'},
  {id:'smallguys',title:'SMALL GUYS',label:'small guys',tagline:'last bean standing',tone:'sg'},
  {id:'surfers',title:'SIDE SURFERS',label:'side surfers',tagline:'the strip that plays itself',tone:'sf'},
  {id:'wordfall',title:'WORD FALL',label:'word fall',tagline:'guess. upgrade. survive.',tone:'wf'},
  {id:'hexcascade',title:'HEX CASCADE',label:'hex cascade',tagline:'match · evolve · survive',tone:'hc'},
  {id:'blockmine',title:'BLOCK MINE',label:'block mine',tagline:'dig · craft · slay the golem',tone:'bm'},
  {id:'webslam',title:'WEB SLAM',label:'web slam',tagline:"swing · serve · send 'em",tone:'ws'},
  {id:'deadline-deck',title:'DEADLINE DECK',label:'deadline deck',tagline:'throw · grind · beat the press',tone:'dd'},
  {id:'scrapshift',title:'SCRAP SHIFT',label:'scrap shift',tagline:'ram · arm · outlast',tone:'ss'},
  {id:'motobowl',title:'MOTO BOWL',label:'moto bowl',tagline:'huddle · hurdle · touchdown',tone:'mb'},
  {id:'ghost-shift',title:'GHOST SHIFT',label:'ghost shift',tagline:'loot · unlock · evade',tone:'gs'},
  {id:'wingrush',title:'WINGRUSH',label:'wingrush',tagline:'dive · soar · shatter',tone:'wr'},
  {id:'grave-garden',title:'GRAVE GARDEN',label:'grave garden',tagline:'plant · fortify · survive',tone:'gg'},
  {id:'swarm-keeper',title:'SWARM KEEPER',label:'swarm keeper',tagline:'lead · build · bring them home',tone:'sk'}
]));
