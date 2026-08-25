
async function getRobloxStatus(operationId,key){
 const r=await fetch(`https://apis.roblox.com/assets/v1/operations/${operationId}`,{
 headers:{"x-api-key":key}
 });
 const d=await r.json();
 return d.error?"REJECTED":d.done?"APPROVED":"PROCESSING";
}
module.exports={getRobloxStatus};
