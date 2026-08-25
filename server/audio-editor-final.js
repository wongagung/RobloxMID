
export function getAudioEditOptions(body){
 return {
  gain: body.gain || 0,
  fadeIn: body.fadeIn || 0,
  fadeOut: body.fadeOut || 0,
  speed: body.speed || 1
 };
}
