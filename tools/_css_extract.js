const fs=require('fs');const s=fs.readFileSync('solver/vendor/katex/katex.min.css','utf8');
for(const pat of ['hide-tail','svg-align','katex-accent','.katex svg']){let i=-1;let n=0;while((i=s.indexOf(pat,i+1))>=0&&n<5){console.log('\nPAT',pat,'AT',i);console.log(s.slice(Math.max(0,i-250),i+500));n++;}}
