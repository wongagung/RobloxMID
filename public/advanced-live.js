
window.advancedAudioOptions = {};
function updateAdvanced(){
 advancedAudioOptions={
  gain:document.getElementById("advGain")?.value||0,
  fadeIn:document.getElementById("advFadeIn")?.value||0,
  fadeOut:document.getElementById("advFadeOut")?.value||0,
  speed:document.getElementById("advSpeed")?.value||1
 };
}
document.addEventListener("input",updateAdvanced);
