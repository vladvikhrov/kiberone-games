const gates={and:['И','∧',2],or:['ИЛИ','∨',2],not:['НЕ','¬',1]};
function initial(i){
  const board={nodes:[],wires:{},bits:levels[i][2].map(()=>0)};
  if(i===5){board.nodes.push({id:'g1',type:'and',slot:4});board.wires={'g1.0':'A','g1.1':'B','o0.0':'g1'}}
  return board;
}
function evaluate(board,bits){
  const cache=Object.fromEntries(bits.map((b,i)=>['ABC'[i],b]));
  function value(id){
    if(id in cache)return cache[id];
    const gate=board.nodes.find(n=>n.id===id);
    if(!gate)return null;
    const input=Array.from({length:gates[gate.type][2]},(_,j)=>value(board.wires[id+'.'+j]));
    const [a,b]=input;
    return cache[id]=input.includes(null)?null:gate.type==='not'?1-a:gate.type==='or'?a|b:a&b;
  }
  return value;
}
function createsCycle(board,source,target){
  const seen=new Set();
  function upstream(id){
    if(id===target)return true;
    if(!id||seen.has(id))return false;
    seen.add(id);
    return [0,1].some(j=>upstream(board.wires[id+'.'+j]));
  }
  return upstream(source);
}
function verify(i,board){
  for(const bits of combinations(levels[i][2].length)){
    const expected=levels[i][5](...bits), value=evaluate(board,bits);
    for(const [j,want] of expected.entries()){
      const got=value(board.wires['o'+j+'.0']);
      if(want!==got)return {bits,j,want,got};
    }
  }
  return null;
}
