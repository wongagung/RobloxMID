
let loadedSource = null;

function loadAudioSource(source){
  loadedSource = source;
  const status = document.getElementById("audio-editor-status");
  if(status){
    status.innerHTML = "🎵 Audio loaded - editor ready";
  }
  const editor = document.getElementById("advanced-editor");
  if(editor) editor.style.display = "block";
}

document.addEventListener("change", e=>{
  if(e.target.type === "file" && e.target.files[0]){
    loadAudioSource(e.target.files[0]);
  }
});

function loadUrlAudio(){
  const url = document.getElementById("audio-url")?.value;
  if(url && (url.includes("youtube.com") || url.includes("youtu.be") || url.includes("soundcloud.com"))){
    loadAudioSource(url);
  }
}
