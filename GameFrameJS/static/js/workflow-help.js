(function () {
  'use strict';
  if (window.GameFrameHelp) return;
  const copy = {
    video: ['Choose the original recording with contact and the early ball flight visible. Keep the original frame rate; a slow-motion playback rate is not necessarily the capture rate.'],
    address: ['Choose the actual field address or a saved location, then check the satellite view. Confirm the correct diamond before placing any marks.'],
    camera: ['Mark where the camera was located, not the hitter or the backstop center. This position helps relate movement in the video to distance on the field.'],
    homeMap: ['Mark home plate on the satellite image. Use the same field as the video; this is the origin for direction and distance.'],
    axis: ['Mark second base to establish the field direction. Select the correct field type so the model uses the appropriate field dimensions.'],
    landing: ['Compare outfield landmarks in the video with the map: fence corners, light poles, scoreboards, and distance signs. Mark first ground contact, not where the ball stopped rolling.', 'Direction strongly affects the speed estimate. A small error can change the inferred distance substantially. Adjust the mark to match the footage, not to reach a preferred speed.'],
    mapConfirm: ['Check camera, home plate, second base, and landing marks before confirming. Drag a marker to correct it, or redo the field marks. The video can help identify outfield landmarks.'],
    homeVideo: ['Click the location of home plate in the video. Use the plate itself rather than a batter\'s foot or the batter\'s box.'],
    rubber: ['Click the pitching rubber in the video, not the pitcher\'s foot or the middle of the mound. Together with the field lines, this establishes camera orientation.'],
    baseline: ['Click two clearly visible points on the indicated baseline, spaced well apart. Follow the foul line itself. The bases themselves do not need to be visible.'],
    ballContact: ['Find where bat and ball meet. Choose whether contact is on the displayed frame or between the previous frame and this one. For contact between frames, display the first frame after contact and click the outbound ball. The ball mark keeps its actual frame time.'],
    ballLater: ['Click the center of the ball in this selected frame. The app selects 10 frames after contact at 30 fps, or 20 at 60 fps, to compare the same elapsed time.', 'Do not click a player, reflection, or the ball\'s shadow. If you cannot identify the ball, choose "Not visible" or "Continue to field marks".'],
    ground: ['Use the first frame where the ball reaches the ground, not a later bounce or when a fielder retrieves it. If first ground contact is not visible, skip this optional step.'],
    player: ['Your earlier player selection is preserved. Review the estimate, then choose "Save hit". Your video prepares in the background after saving.'],
    prediction: ['These are video-based estimates, not radar measurements. Review any distance or direction warning before saving. Technical details remain available for checking the evidence.'],
    crop: ['Drag the crop to keep the action in view and use the "Zoom" control to adjust its size. Check that the bat, ball, and player remain visible around contact. Cropping changes the presentation, not the selected timing frames.'],
    swingContact: ['Choose the frame where bat and ball meet. If contact was already marked during EV modeling, it carries over and this step is skipped.'],
    commitment: ['Choose the frame you identify as commitment to the swing. Use the same visual criterion across your clips so timing comparisons are meaningful. Earlier movement or loading is not necessarily commitment.'],
    swingStart: ['Choose the first movement you want to use as the swing\'s timing reference. Apply that definition consistently across clips.', 'A longer start-to-contact interval is not automatically worse. Starting movement earlier and committing to the swing are different events. Confirming this step saves the tagged swing.'],
    pitchContact: ['Choose the frame when the ball reaches the contact point just in front of home plate, whether the pitch is hit, taken or missed. Release-to-that-point elapsed time is used for the speed estimate.'],
    pitchSetup: ['Set the actual rubber-to-home distance, not base spacing. Choose a reasonable speed range to narrow the release frames you will inspect; the range itself does not measure speed.'],
    release: ['Find the transition from the ball in the hand to the ball free of the hand. Check the previous frame: if the ball is already airborne, move earlier.', 'Select a frame, or select between the adjacent frames when release occurs halfway between them. Check that the throwing arm position also makes sense.'],
    pitchDistances: ['Release extension is the distance in front of the rubber. Contact adjustment accounts for where the ball reaches the bat or glove relative to home. These change flight distance and update the speed without selecting release again.', 'Average speed is distance divided by elapsed time. The out-of-hand estimate includes the displayed correction; it is not a direct radar reading.'],
    matchupPitch: ['Choose the saved pitch the hitter will face. Saved speed measurements accompany the pitch when available. Matchups use the raw pitch footage, not its speed-export title screens.'],
    matchupSwing: ['Choose a saved swing with timing marks. The hitter can be different from the hitter in the pitch video. A known contact frame should not need to be tagged again.'],
    matchupReview: ['Check both clips, then choose "Create Matchup". The videos align at contact so you can compare start and commitment timing against the pitch.', 'This is a timing comparison, not a claim that the hitter actually faced that pitcher or that a shorter swing is better.']
  };
  function topic(heading) {
    if(heading.closest('#setup-modal')?.dataset.contactFinding==='true')return 'ballContactFinding';
    const assistPhase=heading.closest('#setup-modal')?.dataset.ballAssistPhase;
    if(assistPhase==='review')return 'ballAutoReview';
    if(assistPhase==='running')return 'ballAutoDetect';
    const text = heading.textContent.toLowerCase();
    if (heading.id === 'matchup-step-title') return text.includes('pitch') ? 'matchupPitch' : text.includes('swing') ? 'matchupSwing' : 'matchupReview';
    if (heading.id === 'swing_step_title') return ({crop:'crop',contact:'swingContact',commitment:'commitment',start:'swingStart'})[heading.closest('[data-step]').dataset.step];
    if (heading.id === 'pitch_step_title') return text.includes('crop') ? 'crop' : 'pitchContact';
    if (heading.id === 'pv-picker-title') return 'release';
    if (heading.id === 'pv-step-title') return text.includes('distance and speed') || text.includes('test') ? 'pitchSetup' : 'pitchDistances';
    if (heading.id === 'actual-field-map-title') {
      if (/landing|landed|touched the ground/.test(text)) return 'landing';
      if (text.includes('address')) return 'address';
      if (/camera|stood|filming/.test(text)) return 'camera';
      if (text.includes('home')) return 'homeMap';
      if (text.includes('second')) return 'axis';
      return 'mapConfirm';
    }
    if (/first-base|third-base/.test(text)) return 'baseline';
    if (text.includes('home')) return 'homeVideo';
    if (text.includes('rubber')) return 'rubber';
    if (/frames after|detecting.*path/.test(text)) return 'ballLater';
    if (/contact|bat hits|outbound ball/.test(text) && !text.includes('ground')) return 'ballContact';
    if (text.includes('ground')) return 'ground';
    if (/team|hitter|description/.test(text)) return 'player';
    if (/prediction|export/.test(text)) return 'prediction';
    return 'video';
  }
  const selector = '#setup-title,#actual-field-map-title,#swing_step_title,#pitch_step_title,#pv-picker-title,#pv-step-title,#matchup-step-title,#pitch_upload_title,#swing_upload_title,#ev-video-start h3';
  copy.ballAutoReview=['All numbered points on the contact picture, aligned for camera movement.'];
  copy.ballAutoDetect=['You can switch to manual tagging at any time.'];
  copy.ballContactFinding=['Please wait while GameFrame looks for contact. You can check and adjust the suggested frame afterward.'];
  function attach(heading) {
    if (heading.dataset.helpAttached) return;
    heading.dataset.helpAttached = 'true';
    if (document.documentElement.classList.contains('gf-guided')) {
      const brief={video:'Choose your video to begin.',ballContact:'Find contact, then click where bat and ball meet.',ballLater:'Click the ball, or choose "Not visible". Choose "Continue to field marks" when you are ready.',ground:'Mark the first ground contact, if you can see it.',prediction:'Review the estimate, then choose "Save hit". Your video prepares in the background.',player:'Your player selection is saved. Review the estimate, then choose "Save hit".',crop:'Keep the player, bat and ball inside the crop.',swingContact:'Select the frame where bat and ball meet.',commitment:'Select the frame where the hitter commits to the swing.',swingStart:'Select the first movement you use as swing start.',pitchContact:'Mark when the ball reaches the point just in front of home plate, whether hit, taken or missed.',release:'Find the transition from ball in hand to ball released.',matchupPitch:'Choose the saved pitch the hitter will face.',matchupSwing:'Choose a saved swing with timing marks.',matchupReview:'Check both clips, then choose "Create Matchup".'};
      const guidance=document.createElement('p');guidance.className='gf-step-guidance';heading.after(guidance);
      const describe=()=>{
        const key=topic(heading);heading.setAttribute('aria-description',(copy[key]||copy.video)[0]);
        guidance.textContent=brief[key]||(copy[key]||copy.video)[0].split('. ')[0]+'.';
        guidance.hidden=heading.id==='actual-field-map-title'||heading.closest('#setup-modal')?.dataset.step==='groundChoice';
      };
      describe();new MutationObserver(describe).observe(heading,{childList:true,subtree:true,characterData:true});
      return;
    }
    const details = document.createElement('details');
    details.className = 'gf-step-help';
    const summary = document.createElement('summary');
    summary.textContent = 'Help';
    summary.setAttribute('aria-label','Help for this step');
    const content = document.createElement('div');
    content.className = 'gf-step-help-content';
    details.append(summary,content);
    heading.after(details);
    function refresh() {
      details.open = false;
      const paragraphs = copy[topic(heading)] || copy.video;
      content.replaceChildren(...paragraphs.map(text=>{
        const p=document.createElement('p'); p.textContent=text; return p;
      }));
    }
    new MutationObserver(refresh).observe(heading,{childList:true,characterData:true,subtree:true});
    refresh();
  }
  function init() {
    const style=document.createElement('style');
    style.textContent = `.gf-step-help { display:block!important;position:relative;flex:0 0 auto;font:14px/1.5 Arial,sans-serif;color:#243239;letter-spacing:0; }
      .gf-step-help summary { display:list-item;cursor:pointer;padding:8px 12px;min-height:24px;font-weight:600; }
      .gf-step-help summary:focus-visible { outline:3px solid #16796b;outline-offset:2px; }
      .gf-step-help-content { padding:8px 12px;max-width:540px;box-sizing:border-box;background:#f0f5f3;border-left:3px solid #21776b;text-align:left; }
      .gf-step-help-content p { font:14px/1.5 Arial,sans-serif!important;margin:4px 0 10px!important; }
      .gf-step-help:not([open]) .gf-step-help-content { display:none; }
      .gf-step-help[open] { flex-basis:100%;min-width:0; }
      .frame-modal-header:has(.gf-step-help),.matchup-wizard-heading:has(.gf-step-help) { flex-wrap:wrap; }
      @media(max-width:600px) { .gf-step-help-content { max-width:100%; } }`;
    document.head.append(style);
    document.querySelectorAll(selector).forEach(attach);
  }
  window.GameFrameHelp={topic,copy};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
