let all=[];
let list=[];
let index=0;
let selected=null;
let correct=0;
let timer;
let time=0;
let exam=false;

file.onchange=e=>{
 let r=new FileReader();
 r.onload=()=>parse(r.result);
 r.readAsText(e.target.files[0]);
};

function parse(text){
 let lines=text.replace(/\r/g,"").split("\n").map(x=>x.trim());
 let answers=[];
 let answerBlock=false;
 let q=null;

 for(let l of lines){

  if(l.includes("===== ОТВЕТЫ")){
   answerBlock=true;
   continue;
  }

  if(answerBlock){
   let m=l.match(/[A-DА-Г1-4]/i);
   if(m) answers.push(conv(m[0]));
   continue;
  }

  let qm=l.match(/^(\d+)[.)]\s*(.+)/);
  if(qm){
   q={n:+qm[1],t:qm[2],o:[],c:0};
   all.push(q);
   continue;
  }

  let om=l.match(/^[A-DА-Г1-4][).]?\s*(.+)/i);
  if(om && q){
   q.o.push(om[1]);
   continue;
  }

  if(q) q.t+=" "+l;
 }

 for(let i=0;i<all.length;i++)
  all[i].c=answers[i]??0;

 alert("Загружено вопросов: "+all.length);
}

function conv(s){
 s=s.toUpperCase();
 return {A:0,"А":0,"1":0,B:1,"Б":1,"2":1,C:2,"В":2,"3":2,D:3,"Г":3,"4":3}[s]??0;
}

function start(){
 let s=+startInput.value||1;
 let e=+end.value||all.length;
 list=all.slice(s-1,e);
 begin();
}

function examMode(){
 list=[...all].sort(()=>Math.random()-0.5).slice(0,30);
 exam=true;
 begin();
}

function begin(){
 index=0;
 correct=0;
 time=list.length*15;

 document.querySelector(".card").style.display="none";
 test.style.display="block";

 timer=setInterval(()=>{
  time--;
  timerEl.textContent="⏱ "+time+"s";
  if(time<=0) finish();
 },1000);

 show();
}

function show(){
 let q=list[index];
 selected=null;

 qcount.textContent=`${index+1} / ${list.length}`;
 qEl.textContent=q.n+". "+q.t;

 opts.innerHTML="";
 q.o.forEach((o,i)=>{
  let d=document.createElement("div");
  d.className="option";
  d.textContent=o;
  d.onclick=()=>select(i,d);
  opts.appendChild(d);
 });

 bar.style.width=(index/list.length*100)+"%";
}

function select(i,el){
 selected=i;
 document.querySelectorAll(".option").forEach(x=>x.style.outline="none");
 el.style.outline="3px solid #38bdf8";
}

function answer(){
 if(selected==null)return;

 let q=list[index];
 let optsDiv=[...document.querySelectorAll(".option")];

 optsDiv[q.c].classList.add("correct");

 if(selected!=q.c)
  optsDiv[selected].classList.add("wrong");
 else
  correct++;
}

function next(){
 index++;
 if(index>=list.length) finish();
 else show();
}

function finish(){
 clearInterval(timer);
 test.style.display="none";
 result.style.display="block";

 let p=(correct/list.length*100).toFixed(1);
 res.innerHTML=`Правильных ${correct}/${list.length}<br>${p}%`;

 drawChart(p);
}

function drawChart(p){
 let c=chart.getContext("2d");
 c.clearRect(0,0,chart.width,chart.height);

 c.fillStyle="#22c55e";
 c.fillRect(0,chart.height*(1-p/100),chart.width,chart.height);
}
