
let selectedAudio=null;

document.addEventListener("change",e=>{
 if(e.target.type==="file"){
  selectedAudio=e.target.files[0];
  document.getElementById("ae-status").textContent="🎵 Audio loaded";
 }
});

document.getElementById("ae-apply")?.addEventListener("click",()=>{
 document.getElementById("ae-status").textContent="⚙ Processing audio...";
});
