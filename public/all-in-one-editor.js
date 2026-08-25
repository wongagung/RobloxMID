
let loadedAudio = null;

const status = () => document.getElementById("sound-status");

document.getElementById("sound-file")?.addEventListener("change", e => {
  loadedAudio = e.target.files[0];
});

document.getElementById("load-sound")?.addEventListener("click", () => {
  const url = document.getElementById("sound-url")?.value;
  if (loadedAudio || url) {
    status().textContent = "🎵 Audio loaded - editor ready";
  }
});

document.getElementById("apply-edit")?.addEventListener("click", () => {
  status().textContent = "⚙ Processing edit...";
});
