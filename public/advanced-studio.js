
let selectedAudio=null;
document.addEventListener('change',e=>{
 if(e.target.type==='file'){
  selectedAudio=e.target.files[0];
  const s=document.getElementById('roblox-status');
  if(s)s.innerText='Audio loaded - Ready to edit';
 }
});
