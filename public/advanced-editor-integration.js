
function showAdvancedEditor(){
 const e=document.getElementById("advanced-editor");
 if(e)e.style.display="block";
}

document.addEventListener("change",e=>{
 if(e.target.type==="file") showAdvancedEditor();
 if(e.target.value?.includes("youtube")||e.target.value?.includes("soundcloud"))
   showAdvancedEditor();
});
