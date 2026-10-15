output "id" {
  value = aws_vpc.this.id
}
output "public_subnet_ids" {
  value = [for zone in var.azs : aws_subnet.public[zone].id]
}
output "private_subnet_ids" {
  value = [for zone in var.azs : aws_subnet.application[zone].id]
}
output "data_subnet_ids" {
  value = [for zone in var.azs : aws_subnet.data[zone].id]
}
