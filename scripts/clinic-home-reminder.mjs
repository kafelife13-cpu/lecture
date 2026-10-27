const pin=process.env.SOLAPI_SEND_PIN;
if(!pin)throw Error('SOLAPI_SEND_PIN is required');
const key='sb_publishable_IbfVcXs5TmXfumrnK4Somg_7MzygCdh';
const response=await fetch('https://zniwzwanlvvmzkkcmikh.supabase.co/functions/v1/clinic-home-reminder',{
 method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({sendPin:pin}),signal:AbortSignal.timeout(180000)
});
const result=await response.json();
if(!response.ok||!result.success)throw Error('Clinic reminders failed. Review server logs before retrying.');
console.log(JSON.stringify({accepted:result.accepted,needsReview:result.needsReview}));
