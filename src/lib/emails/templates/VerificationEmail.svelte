<script lang="ts">
	import { Html, Head, Body, Preview, Container } from 'better-svelte-email/components';
	import { Alert, Badge, Button, Card } from '$lib/emails/components/ui/index.js';
	import { EmailHeader, EmailFooter } from '$lib/emails/components/layout/index.js';

	let {
		verificationUrl = 'https://example.com/verify?token=xxx',
		expiryMinutes = 20,
		userName = 'there'
	}: {
		verificationUrl?: string;
		expiryMinutes?: number;
		userName?: string;
	} = $props();
</script>

<Html>
	<Head />
	<Body class="mx-auto my-auto bg-white px-2 font-sans">
		<Preview preview="Thanks for signing up — please verify your email" />
		<Container class="mx-auto my-10 max-w-md p-5">
			<Card.Root>
				<EmailHeader />
				<Card.Header>
					<Badge variant="secondary" class="mb-2">Auth</Badge>
					<Card.Title>Verify your email</Card.Title>
					<Card.Description>One quick step to get you started</Card.Description>
				</Card.Header>

				<Card.Content>
					<p class="mb-3 text-sm text-foreground">Hey {userName},</p>

					<p class="mb-3 text-sm text-foreground">
						I'm Moha, creator of JobPilot. I wanted to say thanks for giving us a try.
					</p>

					<p class="mb-4 text-sm text-foreground">
						Please verify your email address to complete your registration. If anything feels
						confusing or missing, I genuinely want to know — this is the kind of feedback that
						shapes what we build next.
					</p>

					<Button class="mb-4" href={verificationUrl}>Verify Email</Button>

					<Alert.Root class="mb-4">
						<Alert.Description>
							This link will expire in {expiryMinutes} minutes.
						</Alert.Description>
					</Alert.Root>

					<p class="mb-1 text-sm text-muted-foreground">Reply anytime :)</p>
					<p class="mb-1 text-sm text-foreground font-medium">Moha</p>
					<p class="text-sm text-muted-foreground">
						GitHub: <a href="https://github.com/Mbehbahani" class="text-muted-foreground underline"
							>github.com/Mbehbahani</a
						>
					</p>
				</Card.Content>

				<Card.Footer>
					<EmailFooter />
				</Card.Footer>
			</Card.Root>
		</Container>
	</Body>
</Html>
