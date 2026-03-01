const slider = document.getElementById("swing_frame_slider");
const img = document.getElementById("swing_frame_preview");

const prevBtn = document.getElementById("swing_prev_frame");
const nextBtn = document.getElementById("swing_next_frame");

const btnStart = document.getElementById("btn_set_start");
const btnDecision = document.getElementById("btn_set_decision");
const btnContact = document.getElementById("btn_set_contact");

const startField = document.getElementById("start_frame");
const decisionField = document.getElementById("decision_frame");
const contactField = document.getElementById("contact_frame");

slider.oninput = () => {
    img.src = `/frame?clip_type=temp_swing&id=${temp_id}&frame=${slider.value}`;
};

prevBtn.onclick = () => {
    let v = Math.max(0, parseInt(slider.value) - 1);
    slider.value = v;
    img.src = `/frame?clip_type=temp_swing&id=${temp_id}&frame=${v}`;
};

nextBtn.onclick = () => {
    let v = Math.min(parseInt(slider.max), parseInt(slider.value) + 1);
    slider.value = v;
    img.src = `/frame?clip_type=temp_swing&id=${temp_id}&frame=${v}`;
};

btnStart.onclick = () => { startField.value = slider.value; };
btnDecision.onclick = () => { decisionField.value = slider.value; };
btnContact.onclick = () => { contactField.value = slider.value; };
