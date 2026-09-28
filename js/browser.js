const histories={1:[],2:[]};
const positions={1:-1,2:-1};

const TheLordBrowser={
  normalize(value){
    let v=(value||"").trim();
    if(!v)return"";
    if(!/^https?:\/\//i.test(v))v="https://"+v;
    try{return new URL(v).href}catch{return""}
  },

  go(id,url,record=true){
    const view=document.querySelector("#view-"+id);
    const frame=view?.querySelector("iframe");
    const placeholder=view?.querySelector(".placeholder");
    const input=document.querySelector('[data-url="'+id+'"]');
    const u=this.normalize(url);
    if(!view||!frame||!u)return false;

    if(record){
      histories[id].splice(positions[id]+1);
      histories[id].push(u);
      positions[id]++;
    }

    if(input)input.value=u;

    // Cada tela possui seu proprio iframe e seu proprio historico.
    // Escondemos o placeholder diretamente para nao depender do cache/CSS.
    if(placeholder){
      placeholder.hidden=true;
      placeholder.style.display="none";
    }

    frame.hidden=false;
    frame.style.display="block";
    frame.style.position="absolute";
    frame.style.inset="0";
    frame.style.width="100%";
    frame.style.height="100%";
    frame.style.minHeight="0";
    frame.src=u;
    return true;
  },

  reload(id){
    const f=document.querySelector("#view-"+id+" iframe");
    if(f&&f.src)f.src=f.src;
  },

  home(id){
    this.go(id,"https://www.google.com");
  },

  back(id){
    if(positions[id]>0){
      positions[id]--;
      this.go(id,histories[id][positions[id]],false);
    }
  },

  forward(id){
    if(positions[id]<histories[id].length-1){
      positions[id]++;
      this.go(id,histories[id][positions[id]],false);
    }
  }
};
