
async function getModerationStatus(operationId,apiKey){
 const r=await fetch(
  `https://apis.roblox.com/assets/v1/operations/${operationId}`,
  {headers:{"x-api-key":apiKey}}
 );
 const d=await r.json();

 if(d.error) return {status:"REJECTED",reason:d.error.message};
 if(d.done) return {status:"APPROVED",assetId:d.response?.assetId};
 return {status:"PROCESSING"};
}

module.exports={getModerationStatus};
