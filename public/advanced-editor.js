
async function applyEditor(){
 const options={
 gain:document.getElementById("gain").value,
 fadeIn:document.getElementById("fadeIn").value,
 fadeOut:document.getElementById("fadeOut").value,
 compressor:document.getElementById("compressor").checked,
 limiter:document.getElementById("limiter").checked
 };
 await fetch("/api/audio/edit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(options)});
}
