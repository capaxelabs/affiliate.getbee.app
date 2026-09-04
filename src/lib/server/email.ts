type Env = App.Platform['env'];

export type EmailOptions = {
	to: string;
	subject: string;
	html: string;
	text?: string;
};

export async function sendEmail(env: Env, options: EmailOptions): Promise<boolean> {
	if (!env?.EMAIL_API_KEY) {
		console.log('[email:dev]', options.to, '—', options.subject);
		console.log(options.text ?? options.html.replace(/<[^>]+>/g, ' ').slice(0, 400));
		return true;
	}

	const body = new FormData();
	body.append('to', options.to);
	body.append('from', env.EMAIL_FROM);
	body.append('subject', options.subject);
	body.append('html', options.html);

	try {
		const res = await fetch(env.EMAIL_API_URL, {
			method: 'POST',
			headers: { 'x-api-key': env.EMAIL_API_KEY },
			body
		});
		if (!res.ok) {
			console.error('email failed', res.status, await res.text().catch(() => ''));
			return false;
		}
		return true;
	} catch (error) {
		console.error('email error', error);
		return false;
	}
}

function layout(env: Env, content: string) {
	return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
	<div style="max-width:560px;margin:0 auto;padding:40px 20px;">
		<div style="background:#fff;border-radius:14px;padding:36px;">
			<p style="margin:0 0 28px;font-size:13px;letter-spacing:2px;text-transform:uppercase;color:#71717a;">${env.APP_NAME}</p>
			${content}
		</div>
		<p style="color:#a1a1aa;font-size:12px;text-align:center;margin-top:20px;">
			&copy; ${new Date().getFullYear()} ${env.APP_NAME}
		</p>
	</div>
</body></html>`;
}

const button = (href: string, label: string) =>
	`<a href="${href}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:13px 28px;border-radius:9px;font-weight:600;font-size:15px;">${label}</a>`;

export function sendLoginCodeEmail(env: Env, to: string, code: string) {
	const content = `
		<h1 style="font-size:20px;color:#18181b;margin:0 0 10px;">Your sign-in code</h1>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 26px;">
			Enter this code to sign in. It expires in 10 minutes.
		</p>
		<div style="background:#f4f4f5;border-radius:10px;padding:22px;text-align:center;margin-bottom:26px;">
			<span style="font-size:38px;font-weight:800;letter-spacing:10px;color:#18181b;">${code}</span>
		</div>
		<p style="color:#71717a;font-size:13px;margin:0;">
			If you didn't try to sign in, ignore this email.
		</p>`;
	return sendEmail(env, {
		to,
		subject: `${code} is your ${env.APP_NAME} sign-in code`,
		html: layout(env, content),
		text: `Your sign-in code is ${code}. It expires in 10 minutes.`
	});
}

export function sendAffiliateApprovedEmail(env: Env, to: string, name: string | null) {
	const content = `
		<h1 style="font-size:20px;color:#18181b;margin:0 0 10px;">You're approved${name ? `, ${name}` : ''}</h1>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 26px;">
			Your affiliate account is live. Grab your links from the dashboard and every install you send
			starts earning right away.
		</p>
		${button(`${env.APP_URL}/app`, 'Open your dashboard')}`;
	return sendEmail(env, {
		to,
		subject: `Your ${env.APP_NAME} account is approved`,
		html: layout(env, content),
		text: `You're approved. Open your dashboard: ${env.APP_URL}/app`
	});
}

export function sendAffiliateRejectedEmail(env: Env, to: string, reason: string | null) {
	const content = `
		<h1 style="font-size:20px;color:#18181b;margin:0 0 10px;">About your application</h1>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 20px;">
			We couldn't approve your affiliate account this time.
		</p>
		${reason ? `<div style="background:#f4f4f5;border-radius:10px;padding:16px;color:#3f3f46;font-size:14px;line-height:1.6;">${reason}</div>` : ''}
		<p style="color:#71717a;font-size:13px;margin:22px 0 0;">Reply to this email if you'd like us to take another look.</p>`;
	return sendEmail(env, {
		to,
		subject: `Update on your ${env.APP_NAME} application`,
		html: layout(env, content),
		text: `We couldn't approve your affiliate account.${reason ? `\n\n${reason}` : ''}`
	});
}

export function sendClaimReviewedEmail(
	env: Env,
	to: string,
	shopDomain: string,
	approved: boolean,
	note: string | null
) {
	const content = `
		<h1 style="font-size:20px;color:#18181b;margin:0 0 10px;">
			Claim ${approved ? 'approved' : 'declined'} — ${shopDomain}
		</h1>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 20px;">
			${
				approved
					? 'This shop is now attributed to you. Commissions start on its next charge.'
					: 'We couldn’t attribute this shop to you.'
			}
		</p>
		${note ? `<div style="background:#f4f4f5;border-radius:10px;padding:16px;color:#3f3f46;font-size:14px;line-height:1.6;margin-bottom:24px;">${note}</div>` : ''}
		${button(`${env.APP_URL}/app/referrals`, 'View referrals')}`;
	return sendEmail(env, {
		to,
		subject: `Referral claim ${approved ? 'approved' : 'declined'} — ${shopDomain}`,
		html: layout(env, content),
		text: `Your claim for ${shopDomain} was ${approved ? 'approved' : 'declined'}.${note ? `\n\n${note}` : ''}`
	});
}

export function sendPayoutPaidEmail(env: Env, to: string, amount: string, reference: string | null) {
	const content = `
		<h1 style="font-size:20px;color:#18181b;margin:0 0 10px;">${amount} is on its way</h1>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 26px;">
			We've sent your payout${reference ? ` (reference ${reference})` : ''}. It can take a few days to
			land depending on your payout method.
		</p>
		${button(`${env.APP_URL}/app/payouts`, 'View payouts')}`;
	return sendEmail(env, {
		to,
		subject: `Payout sent — ${amount}`,
		html: layout(env, content),
		text: `We've sent your payout of ${amount}.${reference ? ` Reference: ${reference}` : ''}`
	});
}

/* ------------------------------------------------- merchant lifecycle mail */

type MerchantLike = { shopDomain: string; name: string | null; ownerName: string | null };
type AppLike = { name: string; listingUrl: string; supportEmail: string | null };

function greeting(merchant: MerchantLike) {
	const who = merchant.ownerName?.split(' ')[0] ?? merchant.name;
	return who ? `Hi ${who},` : 'Hi there,';
}

export function sendMerchantWelcomeEmail(
	env: Env,
	to: string,
	merchant: MerchantLike,
	app: AppLike
) {
	const reply = app.supportEmail ?? env.EMAIL_FROM;
	const content = `
		<h1 style="font-size:20px;color:#18181b;margin:0 0 10px;">Thanks for installing ${app.name}</h1>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 20px;">
			${greeting(merchant)} ${app.name} is now live on
			<strong>${merchant.name ?? merchant.shopDomain}</strong>.
		</p>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 26px;">
			If anything looks off, or you want a hand getting it set up the way you need, just reply to
			this email. A real person reads it.
		</p>
		${button(app.listingUrl, `Open ${app.name}`)}
		<p style="color:#71717a;font-size:13px;margin:24px 0 0;">
			Questions? Reply here or write to ${reply}.
		</p>`;

	return sendEmail(env, {
		to,
		subject: `You're all set with ${app.name}`,
		html: layout(env, content),
		text: `${greeting(merchant)} ${app.name} is now live on ${merchant.name ?? merchant.shopDomain}. Reply to this email if you need a hand. ${app.listingUrl}`
	});
}

export function sendMerchantOffboardEmail(
	env: Env,
	to: string,
	merchant: MerchantLike,
	app: AppLike
) {
	const reply = app.supportEmail ?? env.EMAIL_FROM;
	const content = `
		<h1 style="font-size:20px;color:#18181b;margin:0 0 10px;">Sorry to see you go</h1>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 20px;">
			${greeting(merchant)} you uninstalled ${app.name} from
			<strong>${merchant.name ?? merchant.shopDomain}</strong>. No hard feelings.
		</p>
		<p style="color:#52525b;font-size:15px;line-height:1.6;margin:0 0 20px;">
			One question, if you have a moment: what made you remove it? Missing feature, a bug, price,
			or you just didn't need it any more? Hit reply and tell us in a line. It genuinely shapes
			what we build next.
		</p>
		<p style="color:#71717a;font-size:13px;margin:0;">
			If you'd rather talk it through, write to ${reply}. Your data stays put for 30 days if you
			decide to come back.
		</p>`;

	return sendEmail(env, {
		to,
		subject: `What could we have done better with ${app.name}?`,
		html: layout(env, content),
		text: `${greeting(merchant)} you uninstalled ${app.name} from ${merchant.name ?? merchant.shopDomain}. What made you remove it? Reply and tell us in a line — it shapes what we build next.`
	});
}
