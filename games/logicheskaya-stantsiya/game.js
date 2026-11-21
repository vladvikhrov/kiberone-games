'use strict';
const $=id=>document.getElementById(id);
const exam=new URLSearchParams(location.search).get('mode')==='exam';
const mode=exam?'exam':'assembly', tasks=exam?examTasks:levels;
const key='logic-station-v1-'+mode;
let state;
try{state=JSON.parse(sessionStorage.getItem(key))}catch{}
state ||= {i:0,done:{},boards:{},answers:{},opened:{},mute:false};
let i=state.i, board,history=[],source='',tool='',message='',hint=0,failure,ctx,previousSound=0;
function save(){try{sessionStorage.setItem(key,JSON.stringify(state))}catch{}}
function btn(label,fn,parent,cls=''){
  const b=document.createElement('button');b.textContent=label;b.className=cls;b.onclick=fn;parent.append(b);return b;
}
function start(n){
  state.i=i=n;
  board=state.boards[i] ||= exam?{bits:i===0?[1,0,0]:[0,0,0]}:initial(i);
  history=[];source=tool=message='';hint=previousSound=0;failure=null;render();
}
function edit(fn){
  history.push(JSON.stringify(board));fn();source=tool=message='';failure=null;render();
}
function toggle(j){
  if(exam){board.bits[j]^=1;render()}else edit(()=>board.bits[j]^=1);
}
function listen(on){
  if(on&&!previousSound&&!state.mute&&ctx?.state==='running'){
    const osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.frequency.value=620;gain.gain.setValueAtTime(.07,ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.14);
    osc.connect(gain).connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.15);
  }
  previousSound=on;
}
document.addEventListener('click',()=>{try{ctx ||= new AudioContext();if(ctx.state==='suspended')ctx.resume().catch(()=>{})}catch{}},true);
$('sound').onclick=()=>{state.mute=!state.mute;render()};
function check(){
  failure=verify(i,board);
  if(failure){
    const {bits,j,want,got}=failure;
    message=levels[i][2].map((label,k)=>label+' '+bits[k]).join(', ')+'. '+levels[i][3][j]+': ожидается '+want+', на выходе '+(got??'нет сигнала')+'.';
  }else{
    state.done[i]=true;message='Схема прошла все проверки. '+levels[i][4];
    if(i===2)board.bits=[1,1];
    if(i===6)message+=' · Если F = 1, горит лампа. Иначе звучит динамик. Проверь обе ветки.';
  }
  render();
}
function render(){
  $('chapter').textContent=(exam?'Задание ':'Уровень ')+(i+1)+' / '+tasks.length;
  $('title').textContent=tasks[i][0];$('brief').textContent=tasks[i][1];
  $('counter').textContent='Выполнено '+Object.keys(state.done).length+' / '+tasks.length;
  $('sound').textContent=state.mute?'Звук выкл.':'Звук вкл.';
  document.querySelector('a[href="?mode='+mode+'"]').className='current';
  for(const id of ['answers','actions','tools','board','steps','advice'])$(id).replaceChildren();
  if(exam)examScreen();else assembly();
  $('report').textContent=message || (!exam && state.done[i] ? levels[i][4] : '');
  if(state.done[i]&&i+1<tasks.length)btn('Дальше →',()=>start(i+1),$('actions'));
  $('steps').append(exam?'Задания':'Уровни');
  tasks.forEach((t,j)=>{
    const b=btn((state.done[j]?'✓ ':'')+(j+1),()=>start(j),$('steps'),j===i?'selected':'');
    b.title=t[0];b.disabled=!exam&&j>0&&!state.done[j-1];
  });
  save();
}
const ns='http://www.w3.org/2000/svg';
function svg(parent,tag,attrs){
  const el=document.createElementNS(ns,tag);for(const k in attrs)el.setAttribute(k,attrs[k]);parent.append(el);return el;
}
function assembly(){
  const l=levels[i],value=evaluate(board,board.bits),tools=$('tools');
  const available=Object.keys(gates).slice(0,Math.min(i,3));
  available.forEach(type=>btn('+ '+gates[type][0],()=>{tool=tool===type?'':type;source='';render()},tools,tool===type?'selected':''));
  btn('Удалить',()=>{tool=tool==='delete'?'':'delete';source='';render()},tools,tool==='delete'?'selected':'');
  btn('Отменить',()=>{state.boards[i]=board=JSON.parse(history.pop());source=tool=message='';failure=null;render()},tools).disabled=!history.length;
  btn('Сбросить',()=>edit(()=>Object.assign(board,initial(i))),tools);
  $('instruction').textContent=tool==='delete'?'Нажми на блок или входной контакт провода для удаления.':tool?'Выбери свободное гнездо на монтажном поле.':source?'Теперь нажми входной контакт слева на нужном модуле.':'Выбери выход справа на модуле, затем вход слева на другом.';
  btn('Проверить',check,$('actions'),'primary');
  btn('Подсказка',()=>{hint=Math.min(2,hint+1);render()},$('actions')).disabled=hint===2;
  if(hint)$('advice').textContent=l[5+hint];
  if(failure)btn('Применить набор',()=>edit(()=>board.bits=[...failure.bits]),$('actions'));
  if(i===6&&state.done[i])for(const [title,bits] of [['Если',[1,1,0]],['Иначе',[0,1,0]]])btn(title,()=>edit(()=>board.bits=bits),$('actions'));
  const canvas=svg($('board'),'svg',{viewBox:'0 0 960 380','aria-label':'Монтажное поле'});
  for(const [x,label] of [[20,'Переключатели'],[219,'Логические блоки'],[790,'Устройства']]){
    const text=svg(canvas,'text',{x,y:25,fill:'#d2e2e7','font-size':15});text.textContent=label;
  }
  const cables=svg(canvas,'g',{}),contacts={};
  function box(x,y,w,h){return svg(canvas,'foreignObject',{x,y,width:w,height:h})}
  function port(x,y,id,input){
    contacts[id]=[x,y];const signal=value(input?board.wires[id]:id);
    const b=btn(signal??'○',()=>{
      if(tool==='delete'&&input){edit(()=>delete board.wires[id]);return}
      if(tool==='delete')return;
      if(!input){source=source===id?'':id;tool='';render();return}
      if(!source){message='Сначала выбери выходной контакт.';render();return}
      if(createsCycle(board,source,id.split('.')[0])){source='';message='Получится цикл. Выбери вход другого блока.';render();return}
      edit(()=>board.wires[id]=source);
    },box(x-14,y-14,28,28),'port '+(input&&!board.wires[id]?'empty ':'')+(source===id?'selected':''));
    b.dataset.port=id;b.title=(input?'Вход ':'Выход ')+id;
  }
  function card(id,x,y,w,title,sub,active,inputs,output,action,label){
    const div=document.createElement('div');div.className='module'+(active?' active':'');
    box(x,y,w,70).append(div);
    if(id.startsWith('o')){
      const lamp=document.createElement('span');lamp.className='device';lamp.textContent=title==='Лампа'?(active?'☀':'◯'):title==='Динамик'?(active?'◖)))':'◖'):(active?'▯':'▣');div.append(lamp);
    }
    const name=document.createElement('strong');name.textContent=title;div.append(name);
    if(action)btn(label,action,div);else{const s=document.createElement('small');s.textContent=sub;div.append(s)}
    if(tool==='delete'&&id.startsWith('g')){btn('Снять',()=>edit(()=>{
      board.nodes=board.nodes.filter(n=>n.id!==id);
      for(const [k,v] of Object.entries(board.wires))if(v===id||k.startsWith(id+'.'))delete board.wires[k];
    }),div)}
    for(let j=0;j<inputs;j++)port(x,y+(inputs===1?35:18+34*j),id+'.'+j,true);
    if(output)port(x+w,y+35,id,false);
  }
  const yAt=(j,n)=>190+(j-(n-1)/2)*106-35;
  l[2].forEach((name,j)=>card('ABC'[j],20,yAt(j,l[2].length),141,name+' · '+'ABC'[j],'',board.bits[j],0,true,()=>toggle(j),'Перекл. '+board.bits[j]));
  for(let slot=0;slot<9;slot++){
    const x=219+slot%3*178,y=50+Math.floor(slot/3)*105;
    const node=board.nodes.find(n=>n.slot===slot);
    if(node)card(node.id,x,y,98,gates[node.type][0],gates[node.type][1],value(node.id),gates[node.type][2],true);
    else if(!gates[tool]&&available.length){
      svg(canvas,'rect',{x,y,width:98,height:70,rx:7,fill:'none',stroke:'#74909c','stroke-dasharray':'3 7'});
    }else if(gates[tool])btn('+',()=>edit(()=>board.nodes.push({type:tool,id:'g'+(1+Math.max(0,...board.nodes.map(n=>Number(n.id.slice(1))))),slot})),box(x,y,98,70),'slot');
  }
  let sound=0;
  l[3].forEach((name,j)=>{
    const bit=value(board.wires['o'+j+'.0']);
    const labels={Лампа:['Погашена','Горит'],Динамик:['Тихо','Звучит'],Дверь:['Закрыта','Открыта']};
    card('o'+j,790,yAt(j,l[3].length),150,name,bit===null?'Нет провода':labels[name][bit]+' · '+bit,bit,1,false);
    if(name==='Динамик')sound=bit;
  });
  for(const [to,from] of Object.entries(board.wires)){
    const [x,y]=contacts[from],[u,v]=contacts[to],d=Math.max(40,Math.abs(u-x)*.42);
    const path=svg(cables,'path',{d:'M '+x+' '+y+' C '+(x+d)+' '+y+' '+(u-d)+' '+v+' '+u+' '+v,class:'wire'+(value(from)?' on':'')});
    if(tool==='delete')path.onclick=()=>edit(()=>delete board.wires[to]);
  }
  listen(sound);
}
function examScreen(){
  const task=examTasks[i],options=i===0?['0','1']:i===1?combinations(3).map(b=>b.join('')):permutations;
  const choices=state.answers[i] ||= [];
  const formula=document.createElement('strong');formula.textContent='F = '+task[2];$('tools').append(formula);
  if(i===2){
    const table=document.createElement('table');table.innerHTML='<tr><th>I</th><th>II</th><th>III</th><th>F</th></tr>'+examRows.map(([s,f])=>'<tr>'+[...s,f].map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('');
    $('answers').append(table);
  }
  options.forEach(o=>btn(o,()=>{
    state.answers[i]=i!==1?[o]:choices.includes(o)?choices.filter(c=>c!==o):[...choices,o];
    message='';render();
  },$('answers'),choices.includes(o)?'selected':''));
  btn('Проверить',()=>{
    const correct=i===0?[String(examValue(0,[1,0,0]))]:i===1?options.filter(s=>examValue(1,Array.from(s,Number))):[tableOrder];
    const ok=correct.length===choices.length&&correct.every(o=>choices.includes(o));
    state.opened[i]=true;if(ok)state.done[i]=true;
    message=ok?'Верно. Проверь ход вычислений на пульте.':'Пока не сходится. Разбери скобки на пульте и попробуй ещё раз.';render();
  },$('actions'),'primary').disabled=!choices.length;
  const panel=document.createElement('div');panel.className='exam-panel';$('board').append(panel);
  $('panelTitle').textContent='Пульт разбора';
  $('instruction').textContent='∧ — И     ·     ∨ — ИЛИ     ·     ¬ — НЕ';
  if(!state.opened[i]){panel.textContent='Выбери ответ и нажми «Проверить», чтобы включить пульт.';return}
  const switches=document.createElement('div');panel.append(switches);
  board.bits.forEach((b,j)=>btn('ABC'[j]+' · '+b,()=>toggle(j),switches,b?'selected':''));
  const pair=task[4](...board.bits);
  [...task[3].map((s,j)=>s+' = '+pair[j]),'F = '+pair.join(' ∧ ')+' = '+(pair[0]&pair[1])].forEach(s=>{
    const line=document.createElement('div');line.className='readout';line.textContent=s;panel.append(line);
  });
}
start(i);
