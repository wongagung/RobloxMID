
const {execFile}=require("child_process");
const {promisify}=require("util");
const run=promisify(execFile);

async function processAudio(input, output, opt={}){
 const filters=[];
 if(opt.gain) filters.push(`volume=${opt.gain}dB`);
 if(opt.fadeIn) filters.push(`afade=t=in:d=${opt.fadeIn}`);
 if(opt.fadeOut) filters.push(`afade=t=out:d=${opt.fadeOut}`);
 if(opt.compressor) filters.push("acompressor");
 if(opt.limiter) filters.push("alimiter");
 let args=["-y","-i",input];
 if(filters.length) args.push("-af",filters.join(","));
 args.push(output);
 await run("ffmpeg",args);
 return output;
}
module.exports={processAudio};
