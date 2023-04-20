<script>
setTimeout("randomSentence()", 100);
function randomSentence() {
    var sentences = new Array(
        "✎...  偷得浮生半日闲～",
        "✎...  行到水穷处，坐看云起时",
        "✎...  醉后不知天在水，满船清梦压星河",
        "✎...  人生天地间，忽如远行客",
        "✎...  晚来天欲雪，能饮一杯无？",
        "✎...  风住尘香花已尽，日晚倦梳头",
    );
    var randomSentence = sentences[Math.floor(Math.random() * sentences.length)];
    document.getElementById("search_input").setAttribute("placeholder", randomSentence);
    function changeSize(sizeString, heightStr) {
        var style = document.createElement('style');
        document.head.appendChild(style);
        sheet = style.sheet;
        sheet.addRule('input::placeholder', 'font-size:'+sizeString+';transform: translateY('+heightStr+')');
    }
    /* 句子长度为 25，26 字体缩小 */
    if (24 < randomSentence.length && randomSentence.length <= 26) {
        changeSize("13px", "-2px");
    } else if (26 < randomSentence.length) {
        changeSize("12px", "-3px");
    }}
</script>
