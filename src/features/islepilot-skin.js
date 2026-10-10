/* Original IslePilot editor, hosted with ST25 authentication and API paths. */
(async()=>{
  const status=document.getElementById('skin-client-status');
  try{
    const pilot=window.ST25Pilot;
    const React=pilot.require(52647),ReactDOM=pilot.require(497890);
    const {SkinEditor}=pilot.require(2492),{PublicStringsProvider}=pilot.require(849551);
    const {Toaster}=pilot.require(360112);
    const strings=await fetch('/assets/vendor/islepilot-skin/strings.vi.json').then(response=>{if(!response.ok)throw Error('Không tải được ngôn ngữ');return response.json();});
    const species=['Allosaurus','Beipiaosaurus','Carnotaurus','Ceratosaurus','Deinosuchus','Diabloceratops','Dilophosaurus','Dryosaurus','Gallimimus','Herrerasaurus','Hypsilophodon','Maiasaura','Omniraptor','Pachycephalosaurus','Pteranodon','Stegosaurus','Tenontosaurus','Triceratops','Troodon','Tyrannosaurus'];
    const originalFetch=window.fetch.bind(window);
    // Keep the original client contract; the API key remains exclusively on the server.
    window.fetch=(input,options)=>{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      if(url.origin===location.origin&&url.pathname==='/api/skin/set'){
        let body;try{body=JSON.parse(options?.body||'{}');}catch{return Promise.resolve(new Response(JSON.stringify({error:'Dữ liệu skin không hợp lệ'}),{status:400,headers:{'Content-Type':'application/json'}}));}
        return originalFetch(ST25API.routes.skinApply,{...options,body:JSON.stringify({payload:body.payload})}).then(async response=>{
          const data=await response.json();
          // The portal accepts the command; its API does not expose command-status polling.
          delete data.jobId;
          return new Response(JSON.stringify(data),{status:response.status,headers:{'Content-Type':'application/json'}});
        });
      }
      return originalFetch(input,options);
    };
    class Boundary extends React.Component{
      constructor(props){super(props);this.state={error:null};}
      static getDerivedStateFromError(error){return {error};}
      render(){return this.state.error?React.createElement('p',{role:'alert'},'Không tải được trình chỉnh Skin: '+this.state.error.message):this.props.children;}
    }
    const root=ReactDOM.createRoot(document.getElementById('islepilot-skin-root'));
    let currentSpecies='Tyrannosaurus';
    function render(user){
      if(species.includes(user?.dino?.species))currentSpecies=user.dino.species;
      const identity=user?.steamId||user?.steam_id||'guest';
      root.render(React.createElement(Boundary,null,React.createElement(PublicStringsProvider,{dict:strings},React.createElement(React.Fragment,null,React.createElement(SkinEditor,{key:identity,speciesOptions:species,currentSpecies,canSetSkin:identity!=='guest'&&user?.isLoggedIn!==false,isAdmin:false,serverId:'cmufraiwk7fnooa01vpdzdhm4',slug:'st25',glitchEnabled:true,variant:'embedded'}),React.createElement(Toaster,{theme:'dark',richColors:true})))));
      status.hidden=true;
    }
    render(null);
    if(parent!==window){
      window.addEventListener('message',event=>{
        if(event.origin===location.origin&&event.source===parent&&event.data?.type==='st25-skin-editor-user')render(event.data.user);
      });
      parent.postMessage({type:'st25-skin-editor-ready'},location.origin);
    }else{
      const me=await originalFetch(ST25API.routes.playerMe).then(response=>response.ok?response.json():null).catch(()=>null);
      render(me?.user||me);
    }
    window.ST25OriginalSkin={ready:true,exports:pilot.require(110149),defaults:pilot.require(70454)};
    function reportHeight(){if(parent!==window)parent.postMessage({type:'st25-skin-editor-height',height:Math.ceil(document.body.scrollHeight)},location.origin);}
    const resize=new ResizeObserver(reportHeight);resize.observe(document.body);
    window.addEventListener('pagehide',()=>resize.disconnect(),{once:true});
  }catch(error){status.textContent='Không tải được trình chỉnh Skin: '+error.message;status.setAttribute('role','alert');console.error(error);}
})();
